import { createServiceClient } from "@askarthur/supabase/server";
import { downloadMediaBuffer } from "./r2";
import { transcribeAudio } from "./whisper";
import { analyzeWithClaude, detectInjectionAttempt } from "./claude";
import { scrubPII, incrementStats } from "./scamPipeline";
import { logger } from "./logger";

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
    const scrubbedTranscript = scrubPII(rawTranscript);

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
