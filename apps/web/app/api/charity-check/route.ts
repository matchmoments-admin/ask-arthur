import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runCharityCheck } from "@askarthur/charity-check";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { checkCharityCheckRateLimit } from "@askarthur/utils/rate-limit";
import { resolveRequestId } from "@askarthur/utils/request-id";

import { logCost } from "@/lib/cost-telemetry";

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
  })
  .refine((data) => Boolean((data.abn && data.abn.length === 11) || data.name), {
    message: "Either abn (11 digits) or name (≥2 chars) is required",
    path: ["abn"],
  });

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
    const result = await runCharityCheck({
      abn: input.abn || undefined,
      name: input.name,
      donationUrl: input.donationUrl,
      paymentMethod: input.paymentMethod,
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
