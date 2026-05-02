import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runCharityCheck, ocrLanyard } from "@askarthur/charity-check";
import { validateImageMagicBytes } from "@askarthur/scam-engine/image-validate";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { checkCharityCheckRateLimit } from "@askarthur/utils/rate-limit";
import { resolveRequestId } from "@askarthur/utils/request-id";

import { logCost, PRICING } from "@/lib/cost-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wire schema. The engine has its own internal CharityCheckInput type;
// the route owns the boundary contract and re-projects.
//
// Either `abn` or `name` is required. ABN is normalised to digits-only
// (so "11 005 357 522" or "11-005-357-522" resolves to "11005357522").
const CharityCheckBodySchema = z
  .object({
    abn: z
      .string()
      .max(20)
      .transform((s) => s.replace(/\D/g, ""))
      .refine((s) => s === "" || s.length === 11, {
        message: "ABN must be 11 digits",
      })
      .optional(),
    name: z.string().min(2).max(200).optional(),
    donationUrl: z.string().url().max(2048).optional(),
    paymentMethod: z
      .enum(["card", "regular_debit", "cash", "gift_card", "crypto", "bank_transfer"])
      .optional(),
    idShown: z.enum(["yes", "no", "refused", "skipped"]).optional(),
    inPersonContext: z.boolean().optional(),
    /** v0.2b — base64 image (without data: prefix) of a fundraiser
     *  lanyard / badge / flyer. When present, we OCR via Claude Vision
     *  and pre-fill abn/name from the extracted fields. */
    image: z.string().min(100).max(8_000_000).optional(),
  })
  .refine(
    (data) =>
      Boolean((data.abn && data.abn.length === 11) || data.name || data.image),
    {
      message: "Either abn (11 digits), name (≥2 chars), or image is required",
      path: ["abn"],
    },
  );

export async function POST(req: NextRequest) {
  // Server-only flag — controls whether the route accepts traffic. The
  // public-flag charityCheck only gates the consumer page rendering; the
  // route is gated independently so we can ship the page without an
  // active backend if needed.
  if (!featureFlags.charityCheck) {
    return NextResponse.json(
      { error: { code: "feature_disabled", message: "Charity Check is not enabled in this environment." } },
      { status: 503 },
    );
  }

  const requestId = resolveRequestId(req.headers);

  // IP-based rate limiting — fail-closed in prod, fail-open in dev.
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const rate = await checkCharityCheckRateLimit("cc_lookup", ip);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "rate_limited",
          message: rate.message ?? "Too many requests. Please try again later.",
        },
      },
      {
        status: 429,
        headers: {
          "X-Request-Id": requestId,
          ...(rate.resetAt ? { "Retry-After": String(Math.max(1, Math.round((rate.resetAt.getTime() - Date.now()) / 1000))) } : {}),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const parsed = CharityCheckBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_input",
          message: parsed.error.issues[0]?.message ?? "Invalid input",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const input = parsed.data;
  const t0 = Date.now();
  try {
    // v0.2b: when an image is supplied, OCR it via Claude Vision first
    // and use the extracted fields to fill ABN/name when the user didn't
    // type them explicitly. Explicit input always wins over OCR — the
    // user typed it on purpose.
    let ocrAbn: string | undefined;
    let ocrName: string | undefined;
    if (input.image) {
      const magic = validateImageMagicBytes(input.image);
      if (!magic.valid || !magic.detectedType) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_input",
              message: "Invalid image format. Supported: JPEG, PNG, GIF, WebP.",
            },
          },
          { status: 400, headers: { "X-Request-Id": requestId } },
        );
      }
      const ocrStart = Date.now();
      const extracted = await ocrLanyard(
        input.image,
        magic.detectedType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      );
      ocrAbn = extracted.abn;
      ocrName = extracted.charity_name;
      // Cost telemetry for the OCR call (separate row so /admin/costs
      // surfaces image-spend distinctly from registry lookups).
      logCost({
        feature: "charity_check",
        provider: "anthropic",
        operation: "claude-haiku-4-5-ocr-lanyard",
        // ~600 input tokens (image + system + user prompt) + ~150 output
        units: 750,
        unitCostUsd: PRICING.CLAUDE_HAIKU_4_5_INPUT_USD_PER_TOKEN,
        requestId,
        metadata: {
          extracted: extracted.extracted,
          had_charity_name: Boolean(extracted.charity_name),
          had_abn: Boolean(extracted.abn),
          ocr_latency_ms: Date.now() - ocrStart,
        },
      });
    }

    const result = await runCharityCheck({
      // Explicit input wins over OCR — user typed it on purpose.
      abn: (input.abn || undefined) ?? ocrAbn,
      name: input.name ?? ocrName,
      donationUrl: input.donationUrl,
      paymentMethod: input.paymentMethod,
      idShown: input.idShown,
      inPersonContext: input.inPersonContext,
      requestId,
    });

    // Cost telemetry — ACNC + ABR are zero-marginal-cost in v0.1 (local
    // Postgres + Redis-cached free ABR endpoint), but the row still
    // populates the feature in /admin/costs and lets the brake matrix
    // catch any future paid provider that lands under the same feature.
    logCost({
      feature: "charity_check",
      provider: "composite",
      operation: "run_charity_check",
      units: 1,
      estimatedCostUsd: 0,
      requestId,
      metadata: {
        verdict: result.verdict,
        composite_score: result.composite_score,
        providers_used: result.providers_used,
        latency_ms: Date.now() - t0,
        had_abn: Boolean(input.abn),
        had_name: Boolean(input.name),
        had_image: Boolean(input.image),
        ocr_filled_abn: !input.abn && Boolean(ocrAbn),
        ocr_filled_name: !input.name && Boolean(ocrName),
      },
    });

    return NextResponse.json(result, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (err) {
    logger.error("charity-check route failed", {
      error: String(err),
      requestId,
    });
    logCost({
      feature: "charity-check-error",
      provider: "internal",
      operation: "run_charity_check",
      units: 1,
      estimatedCostUsd: 0,
      requestId,
      metadata: { error: String(err) },
    });
    return NextResponse.json(
      { error: { code: "internal_error", message: "Something went wrong. Please try again." } },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}
