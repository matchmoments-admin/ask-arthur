import { NextRequest, NextResponse } from "next/server";
import { analyzeAudioForDeepfake } from "@askarthur/scam-engine/deepfake-detect";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["audio/wav", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm"];

export async function POST(req: NextRequest) {
  if (!featureFlags.deepfakeDetection) {
    return NextResponse.json(
      { error: "Deepfake detection is not enabled" },
      { status: 404 }
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
