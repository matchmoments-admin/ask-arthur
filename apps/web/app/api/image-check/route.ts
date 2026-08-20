import { NextRequest, NextResponse } from "next/server";
import { checkHiveAI } from "@askarthur/scam-engine/hive-ai";
import { assertSafeURL } from "@askarthur/scam-engine/ssrf-guard";
import { fetchImageBytes, sha256Hex } from "@askarthur/scam-engine/image-fetch";
import { validateImageMagicBytes } from "@askarthur/scam-engine/image-validate";
import { detectC2PA } from "@askarthur/scam-engine/c2pa-detect";
import { verifyC2PA } from "@askarthur/scam-engine/c2pa-verify";
import { detectMetadataOrigin } from "@askarthur/scam-engine/metadata-origin";
import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { checkImageUploadRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  WebImageCheckUrlRequestSchema,
  type WebImageCheckResponse,
} from "@askarthur/types";
import { logCost, PRICING } from "@/lib/cost-telemetry";

// Public web image checker (/image-check page). Two modes:
// - JSON {imageUrl}: Hive AI classifier (paid, braked) + byte-derived
//   AI-origin ladder (C2PA presence/validation + claimed-origin metadata).
// - multipart upload: the DETERMINISTIC ladder only — no classifier, no
//   Claude, zero marginal cost. aiGenerated/deepfake stay null, which the
//   UI must render as "did not run", never "clean".
//
// Unauthenticated, so the budget posture is: per-IP sliding-window limit
// (5/h, fail-closed in prod) BEFORE any paid work + the shared hive_ai
// daily brake behind it. No Claude-vision pass on this surface, and no
// persistence — evidence records (ADR-0022) stay extension-only because
// image_check_records is keyed on an install-id hash this surface doesn't
// have. Bytes live only for the request (ADR-0010).

const DISCLAIMER =
  "AI-detection classifiers are probabilistic. A high score means the image shares characteristics with AI-generated content, not certainty either way. No provenance data found is normal — most platforms strip it on upload.";

const MAX_UPLOAD_BYTES = 5_000_000;
const VERDICT_CLASSES = new Set(["ai_generated", "not_ai_generated", "deepfake"]);
const BREAKDOWN_TOP_N = 3;

function generatorBreakdown(
  classes: Array<{ class: string; score: number }> | undefined,
): Array<{ class: string; score: number }> | null {
  if (!classes || classes.length === 0) return null;
  const generators = classes
    .filter((c) => !VERDICT_CLASSES.has(c.class) && c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, BREAKDOWN_TOP_N);
  return generators.length > 0 ? generators : null;
}

/** The deterministic AI-origin ladder over fetched/uploaded bytes. */
async function originLadder(buffer: Buffer): Promise<{
  contentCredentials: WebImageCheckResponse["contentCredentials"];
  metadataOrigin: WebImageCheckResponse["metadataOrigin"];
}> {
  let contentCredentials: WebImageCheckResponse["contentCredentials"] =
    detectC2PA(buffer);
  const metadataOrigin = detectMetadataOrigin(buffer);
  if (contentCredentials.present && featureFlags.imageCheckC2paValidate) {
    const verification = await verifyC2PA(
      buffer,
      `image/${contentCredentials.format ?? "jpeg"}`,
    );
    if (verification) {
      contentCredentials = { ...contentCredentials, ...verification };
    }
  }
  return { contentCredentials, metadataOrigin };
}

export async function POST(req: NextRequest) {
  try {
    // Payload cap: JSON mode is just a URL; multipart carries the image.
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > MAX_UPLOAD_BYTES + 50_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    // Same gate as the extension route — the whole Image Check Module is
    // dark until NEXT_PUBLIC_FF_IMAGE_CHECK is on.
    if (!featureFlags.imageCheck) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Image checking is not currently enabled." },
        { status: 503 },
      );
    }

    const ip =
      req.headers.get("x-real-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const rate = await checkImageUploadRateLimit(ip);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "rate_limited", message: rate.message ?? "Too many checks. Try again later." },
        {
          status: 429,
          headers: rate.resetAt
            ? { "Retry-After": String(Math.max(1, Math.round((rate.resetAt.getTime() - Date.now()) / 1000))) }
            : undefined,
        },
      );
    }

    const contentType = req.headers.get("content-type") ?? "";

    // ---- upload mode: deterministic ladder only --------------------------
    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: "invalid_file", message: "Upload one image up to 5 MB." },
          { status: file && file instanceof Blob && file.size > MAX_UPLOAD_BYTES ? 413 : 400 },
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const { valid } = validateImageMagicBytes(buffer.toString("base64"));
      if (!valid) {
        return NextResponse.json(
          { error: "unsupported_file", message: "That file doesn't look like a JPEG, PNG, GIF, or WebP image." },
          { status: 422 },
        );
      }
      const ladder = await originLadder(buffer);
      const response: WebImageCheckResponse = {
        checked: true,
        mode: "upload",
        aiGenerated: null,
        deepfake: null,
        generatorSource: null,
        generatorBreakdown: null,
        ...ladder,
        imageSha256: await sha256Hex(buffer),
        disclaimer: DISCLAIMER,
      };
      return NextResponse.json(response);
    }

    // ---- url mode: Hive + ladder -----------------------------------------
    const body = await req.json().catch(() => null);
    const parsed = WebImageCheckUrlRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }
    const { imageUrl } = parsed.data;
    if (!/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json(
        { error: "unsupported_image_url", message: "Paste a direct http(s) image link, or upload the file instead." },
        { status: 422 },
      );
    }
    try {
      assertSafeURL(imageUrl);
    } catch {
      return NextResponse.json(
        { error: "unsafe_url", message: "That URL points somewhere we won't fetch." },
        { status: 422 },
      );
    }

    // Vendor brake before the paid call (shared with the extension surface).
    let hive: Awaited<ReturnType<typeof checkHiveAI>> = null;
    if (!(await isFeatureBraked("hive_ai"))) {
      hive = await checkHiveAI(imageUrl);
      logCost({
        feature: "hive_ai",
        provider: "hive",
        operation: "sync-task",
        units: 1,
        unitCostUsd: PRICING.HIVE_AI_USD_PER_IMAGE,
        metadata: {
          surface: "image_check_web",
          has_result: hive !== null,
          is_ai_generated: hive?.isAiGenerated ?? false,
          is_deepfake: hive?.isDeepfake ?? false,
        },
        requestId: null,
      });
    }

    const bytes = await fetchImageBytes(imageUrl);
    const ladder = bytes
      ? await originLadder(bytes.buffer)
      : { contentCredentials: null, metadataOrigin: null };

    if (!hive && !bytes) {
      const unavailable: WebImageCheckResponse = {
        checked: false,
        reason: "scan_unavailable",
        mode: "url",
        aiGenerated: null,
        deepfake: null,
        generatorSource: null,
        generatorBreakdown: null,
        contentCredentials: null,
        metadataOrigin: null,
        imageSha256: null,
        disclaimer: DISCLAIMER,
      };
      return NextResponse.json(unavailable);
    }

    const response: WebImageCheckResponse = {
      checked: true,
      mode: "url",
      aiGenerated: hive ? { likely: hive.isAiGenerated, confidence: hive.aiConfidence } : null,
      deepfake: hive ? { likely: hive.isDeepfake, confidence: hive.deepfakeConfidence } : null,
      generatorSource: hive?.generatorSource ?? null,
      generatorBreakdown: hive ? generatorBreakdown(hive.classes) : null,
      ...ladder,
      imageSha256: bytes?.sha256 ?? null,
      disclaimer: DISCLAIMER,
    };
    return NextResponse.json(response);
  } catch (err) {
    logger.error("Web image check error", { error: String(err) });
    return NextResponse.json(
      { error: "image_check_failed", message: "Something went wrong checking this image." },
      { status: 500 },
    );
  }
}
