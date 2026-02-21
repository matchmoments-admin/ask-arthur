import { NextRequest, NextResponse } from "next/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getMediaJob } from "@/lib/mediaAnalysis";

export async function GET(req: NextRequest) {
  if (!featureFlags.mediaAnalysis) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json(
      { error: "validation_error", message: "jobId query parameter is required" },
      { status: 400 }
    );
  }

  const job = await getMediaJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: "not_found", message: "Job not found" },
      { status: 404 }
    );
  }

  const isTerminal = job.status === "complete" || job.status === "error";

  return NextResponse.json(
    {
      jobId: job.job_id,
      status: job.status,
      ...(job.status === "complete" && {
        verdict: job.verdict,
        confidence: job.confidence,
        summary: job.summary,
        redFlags: job.red_flags,
        nextSteps: job.next_steps,
        deepfakeScore: job.deepfake_score,
        deepfakeProvider: job.deepfake_provider,
        phoneRiskFlags: job.phone_numbers,
      }),
      ...(job.status === "error" && {
        errorMessage: job.error_message,
      }),
    },
    {
      headers: {
        "Cache-Control": isTerminal
          ? "private, max-age=60"
          : "no-store",
      },
    }
  );
}
