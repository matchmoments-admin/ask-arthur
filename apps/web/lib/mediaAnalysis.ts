import { createServiceClient } from "@askarthur/supabase/server";
import { downloadMediaBuffer } from "./r2";
import { transcribeAudio } from "./whisper";
import {
  analyzeWithClaude,
  detectInjectionAttempt,
  sanitizeUnicode,
} from "@askarthur/scam-engine/claude";
import { scrubPII } from "@askarthur/scam-engine/sanitize";
import { incrementStats } from "@askarthur/scam-engine/pipeline";
import { logger } from "@askarthur/utils/logger";
import { logCost, claudeHaikuCostUsd } from "@/lib/cost-telemetry";

export interface MediaJob {
  id: string;
  job_id: string;
  r2_key: string;
  media_type: string;
  status: string;
  transcript: string | null;
  verdict: string | null;
  confidence: number | null;
  summary: string | null;
  red_flags: string[];
  next_steps: string[];
  scam_type: string | null;
  channel: string | null;
  impersonated_brand: string | null;
  injection_detected: boolean;
  deepfake_score: number | null;
  deepfake_provider: string | null;
  phone_numbers: string[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Insert a new pending media analysis job.
 */
export async function createMediaJob(
  jobId: string,
  r2Key: string,
  mediaType: string = "audio"
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("Supabase not configured — skipping media job creation");
    return;
  }

  const { error } = await supabase.from("media_analyses").insert({
    job_id: jobId,
    r2_key: r2Key,
    media_type: mediaType,
    status: "pending",
  });

  if (error) {
    logger.error("Failed to create media job", { jobId, error: error.message });
    throw new Error(`Failed to create media job: ${error.message}`);
  }
}

/**
 * Fetch a media job by its job_id.
 */
export async function getMediaJob(jobId: string): Promise<MediaJob | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("media_analyses")
    .select("*")
    .eq("job_id", jobId)
    .single();

  if (error || !data) return null;
  return data as MediaJob;
}

/**
 * Update fields on a media job (internal use).
 */
async function updateMediaJob(
  jobId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("media_analyses")
    .update(updates)
    .eq("job_id", jobId);

  if (error) {
    logger.error("Failed to update media job", { jobId, error: error.message });
    throw new Error(`Failed to update media job: ${error.message}`);
  }
}

/**
 * Run the full media analysis pipeline:
 * 1. Transcribe audio via Whisper
 * 2. Scrub PII from transcript
 * 3. Analyze with Claude
 * 4. Check for prompt injection
 * 5. Store results
 */
export async function runMediaAnalysis(
  jobId: string,
  r2Key: string
): Promise<MediaJob | null> {
  try {
    // 1. Set status → transcribing, download audio, transcribe
    await updateMediaJob(jobId, { status: "transcribing" });

    const audioBuffer = await downloadMediaBuffer(r2Key);
    if (!audioBuffer) {
      throw new Error("Failed to download audio from R2");
    }

    const filename = r2Key.split("/").pop() || "audio.mp3";
    const { text: rawTranscript } = await transcribeAudio(audioBuffer, filename);

    if (!rawTranscript.trim()) {
      throw new Error("Whisper returned empty transcript");
    }

    // 2. Scrub PII from transcript
    // Fold invisible Unicode before scrubbing (same PII-evasion fix as
    // report-store.ts, 2026-08-21).
    const scrubbedTranscript = scrubPII(sanitizeUnicode(rawTranscript));

    // 3. Set status → analyzing, store transcript, run Claude
    await updateMediaJob(jobId, {
      status: "analyzing",
      transcript: scrubbedTranscript,
    });

    const aiResult = await analyzeWithClaude(scrubbedTranscript);

    // 4. Check for prompt injection in transcript
    const injectionCheck = detectInjectionAttempt(scrubbedTranscript);
    if (injectionCheck.detected) {
      if (aiResult.verdict === "SAFE") {
        aiResult.verdict = "SUSPICIOUS";
      }
      aiResult.redFlags.push(
        "This audio contains manipulation patterns that attempt to influence the analysis"
      );
    }

    // 5. Set status → complete with all results
    await updateMediaJob(jobId, {
      status: "complete",
      verdict: aiResult.verdict,
      confidence: aiResult.confidence,
      summary: aiResult.summary,
      red_flags: aiResult.redFlags,
      next_steps: aiResult.nextSteps,
      scam_type: aiResult.scamType || null,
      channel: aiResult.channel || null,
      impersonated_brand: aiResult.impersonatedBrand || null,
      injection_detected: injectionCheck.detected,
    });

    // 6. Fire-and-forget: increment stats
    incrementStats(aiResult.verdict, null).catch((err) =>
      logger.error("incrementStats fire-and-forget failed (media)", { error: String(err) })
    );

    // 7. Cost telemetry. Until now this leg called Claude and recorded
    // nothing — the file's own Whisper call logs (lib/whisper.ts), so the
    // omission was Claude-specific and /api/media/analyze spend was invisible
    // to /admin/costs, the weekly digest and the DAILY_COST_THRESHOLD_USD gate.
    //
    // Its OWN try/catch, and deliberately after the status:'complete' write
    // above: `logCost` calls createServiceClient() outside its internal try, so
    // it CAN throw, and anything thrown here lands in the outer catch that
    // stamps status:'error'. That would turn a finished, already-billed
    // analysis into a failed job — a regression caused purely by adding
    // observability. Telemetry never fails the work it measures.
    try {
      if (aiResult.usage) {
        await logCost({
          feature: "media_analyze",
          provider: "anthropic",
          operation: "claude-haiku-4-5-20251001",
          units: aiResult.usage.inputTokens + aiResult.usage.outputTokens,
          estimatedCostUsd: claudeHaikuCostUsd(
            aiResult.usage.inputTokens,
            aiResult.usage.outputTokens,
          ),
          metadata: {
            input_tokens: aiResult.usage.inputTokens,
            output_tokens: aiResult.usage.outputTokens,
            job_id: jobId,
          },
        });
      }
    } catch (err) {
      logger.warn("media_analyze cost telemetry failed (non-fatal)", {
        jobId,
        error: String(err),
      });
    }

    return getMediaJob(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Media analysis pipeline failed", { jobId, error: message });

    // Set error status
    await updateMediaJob(jobId, {
      status: "error",
      error_message: message,
    }).catch(() => {});

    throw err;
  }
}
