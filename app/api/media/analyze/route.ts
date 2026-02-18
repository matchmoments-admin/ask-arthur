import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@/lib/featureFlags";
import { getMediaJob, runMediaAnalysis } from "@/lib/mediaAnalysis";
import { logger } from "@/lib/logger";

const RequestSchema = z.object({
  jobId: z.string().uuid("Invalid job ID"),
});

export async function POST(req: NextRequest) {
  if (!featureFlags.mediaAnalysis) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { jobId } = parsed.data;

    // Verify job exists
    const job = await getMediaJob(jobId);
    if (!job) {
      return NextResponse.json(
        { error: "not_found", message: "Job not found" },
        { status: 404 }
      );
    }

    // Idempotent — if already processing or complete, return current status
    if (job.status !== "pending") {
      return NextResponse.json({
        jobId: job.job_id,
        status: job.status,
        ...(job.status === "complete" && {
          verdict: job.verdict,
          confidence: job.confidence,
          summary: job.summary,
          redFlags: job.red_flags,
          nextSteps: job.next_steps,
        }),
        ...(job.status === "error" && {
          errorMessage: job.error_message,
        }),
      });
    }

    // Run analysis synchronously (up to 60s via vercel.json maxDuration)
    const result = await runMediaAnalysis(jobId, job.r2_key);

    if (!result) {
      return NextResponse.json(
        { error: "analysis_failed", message: "Analysis completed but result not found." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      jobId: result.job_id,
      status: result.status,
      verdict: result.verdict,
      confidence: result.confidence,
      summary: result.summary,
      redFlags: result.red_flags,
      nextSteps: result.next_steps,
      deepfakeScore: result.deepfake_score,
      deepfakeProvider: result.deepfake_provider,
      phoneRiskFlags: result.phone_numbers,
    });
  } catch (err) {
    logger.error("Media analyze route error", { error: String(err) });
    return NextResponse.json(
      { error: "analysis_failed", message: "Something went wrong analyzing your audio. Please try again." },
      { status: 500 }
    );
  }
}
