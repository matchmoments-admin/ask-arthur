import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@/lib/featureFlags";
import { checkRateLimit } from "@/lib/rateLimit";
import { isAcceptedAudioType, createPresignedUploadUrl } from "@/lib/r2";
import { createMediaJob } from "@/lib/mediaAnalysis";
import { logger } from "@/lib/logger";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — Whisper API limit

const RequestSchema = z.object({
  contentType: z.string().refine(isAcceptedAudioType, {
    message: "Unsupported audio format. Accepted: MP3, M4A, WAV, WebM, OGG, FLAC",
  }),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE, {
    message: `File must be under ${MAX_FILE_SIZE / 1024 / 1024}MB`,
  }),
});

export async function POST(req: NextRequest) {
  if (!featureFlags.mediaAnalysis) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    // Rate limit (shares quotas with text analysis)
    const ip =
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

    const rateCheck = await checkRateLimit(ip, ua);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "rate_limited", message: rateCheck.message },
        { status: 429 }
      );
    }

    // Validate input
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { contentType } = parsed.data;

    // Generate job ID and presigned URL
    const jobId = crypto.randomUUID();
    const presigned = await createPresignedUploadUrl(contentType, jobId);
    if (!presigned) {
      logger.error("R2 not configured — cannot create presigned URL");
      return NextResponse.json(
        { error: "storage_unavailable", message: "File storage is not configured." },
        { status: 503 }
      );
    }

    // Create DB row in pending state
    await createMediaJob(jobId, presigned.r2Key, "audio");

    return NextResponse.json({
      jobId,
      uploadUrl: presigned.uploadUrl,
    });
  } catch (err) {
    logger.error("Media upload route error", { error: String(err) });
    return NextResponse.json(
      { error: "upload_failed", message: "Failed to prepare upload. Please try again." },
      { status: 500 }
    );
  }
}
