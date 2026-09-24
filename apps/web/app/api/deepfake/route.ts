import { NextRequest, NextResponse } from "next/server";
import { analyzeAudioForDeepfake } from "@askarthur/scam-engine/deepfake-detect";
import { isFeatureBrakedOrUnknown } from "@askarthur/scam-engine/cost-log";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { checkDeepfakeRateLimit } from "@askarthur/utils/rate-limit";
import { logCost } from "@/lib/cost-telemetry";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["audio/wav", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm"];

export async function POST(req: NextRequest) {
  if (!featureFlags.deepfakeDetection) {
    return NextResponse.json(
      { error: "Deepfake detection is not enabled" },
      { status: 404 }
    );
  }

  // Each request can reach a paid vendor: per-IP limit (fail-closed in prod)
  // and an operator kill-switch, both before the upload is read.
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rate = await checkDeepfakeRateLimit(ip);
  if (!rate.allowed) {
    if (rate.reason === "store_unavailable") {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    const retryAfter = rate.resetAt
      ? Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000))
      : 3600;
    return NextResponse.json(
      { error: rate.message ?? "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  if (await isFeatureBrakedOrUnknown("deepfake")) {
    return NextResponse.json(
      { error: "Deepfake detection is temporarily paused" },
      { status: 503, headers: { "Retry-After": "3600" } },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("audio") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 10 MB)" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported audio format: ${file.type}` },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const result = await analyzeAudioForDeepfake(buffer, file.type);
    if (result.provider !== "none") {
      // Vendor unit prices are not all known here: volume is logged at $0 so
      // the ceiling stays visible (free-tier convention).
      logCost({
        feature: "deepfake",
        provider: result.provider,
        operation: "audio-check",
        units: 1,
        unitCostUsd: 0,
        metadata: { bytes: file.size, mime: file.type },
        requestId: null,
      });
    }

    return NextResponse.json({
      isDeepfake: result.isDeepfake,
      confidence: result.confidence,
      provider: result.provider,
    });
  } catch (err) {
    logger.error("Deepfake detection error", { error: err });
    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}
