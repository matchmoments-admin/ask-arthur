import { createServiceClient } from "@askarthur/supabase/server";
import type { AnalysisResult, PhoneLookupResult } from "@askarthur/types";
import { logger } from "@askarthur/utils/logger";
// PII scrubbing is a pre-processing step, not storage logic — it lives in ./sanitize.
import { scrubPII, scrubPhoneForStorage } from "./sanitize";

type UploadScreenshotFn = (buffer: Buffer, contentType: string) => Promise<string | null>;

// Store a PII-scrubbed scam record for HIGH_RISK verdicts only.
// Returns the inserted row ID (or null on error / no client).
export async function storeVerifiedScam(
  analysis: AnalysisResult,
  region: string | null,
  imagesBase64?: string[],
  uploadScreenshot?: UploadScreenshotFn
): Promise<number | null> {
  try {
    const supabase = createServiceClient();
    if (!supabase) return null; // no-op in local dev

    const scrubbedSummary = scrubPII(analysis.summary);
    const scrubbedFlags = analysis.redFlags.map(scrubPII);

    // Upload screenshots to R2 if provided
    const screenshotKeys: string[] = [];
    if (imagesBase64 && imagesBase64.length > 0 && uploadScreenshot) {
      for (const imgBase64 of imagesBase64) {
        try {
          const buffer = Buffer.from(imgBase64, "base64");
          if (buffer.length > 4 * 1024 * 1024) {
            logger.info("Skipping R2 upload — decoded image exceeds 4MB", { size: buffer.length });
            continue;
          }
          let contentType = "image/png";
          if (imgBase64.startsWith("/9j/")) contentType = "image/jpeg";
          else if (imgBase64.startsWith("R0lGOD")) contentType = "image/gif";
          else if (imgBase64.startsWith("UklGR")) contentType = "image/webp";
          const key = await uploadScreenshot(buffer, contentType);
          if (key) screenshotKeys.push(key);
        } catch (err) {
          logger.error("R2 upload failed (non-blocking)", { error: String(err) });
        }
      }
      if (imagesBase64.length > 1) {
        logger.info(`Uploaded ${screenshotKeys.length}/${imagesBase64.length} screenshots to R2`);
      }
    } else {
      logger.info("HIGH_RISK verdict stored without screenshot");
    }

    // Store first key in screenshot_key for backward compat
    const screenshotKey = screenshotKeys.length > 0 ? screenshotKeys[0] : null;

    const { data, error } = await supabase.from("verified_scams").insert({
      scam_type: analysis.scamType || "other",
      channel: analysis.channel,
      summary: scrubbedSummary,
      red_flags: scrubbedFlags,
      region,
      confidence_score: analysis.confidence,
      impersonated_brand: analysis.impersonatedBrand,
      ...(screenshotKey && { screenshot_key: screenshotKey }),
    }).select("id").single();

    if (error) {
      logger.error("verified_scams insert failed", {
        error: error.message,
        code: error.code,
      });
      return null;
    }

    return data?.id ?? null;
  } catch (err) {
    logger.error("Failed to store verified scam", { error: String(err) });
    return null;
  }
}

// Phase 2: Store phone lookup results for a media analysis (HIGH_RISK only)
export async function storePhoneLookups(
  analysisId: string,
  lookups: PhoneLookupResult[]
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase || lookups.length === 0) return;

  try {
    const rows = lookups.map((l) => ({
      analysis_id: analysisId,
      phone_number_scrubbed: scrubPhoneForStorage(l.phoneNumber),
      country_code: l.countryCode,
      line_type: l.lineType,
      carrier: l.carrier,
      is_voip: l.isVoip,
      risk_flags: l.riskFlags,
    }));

    const { error } = await supabase.from("phone_lookups").insert(rows);

    if (error) {
      logger.error("phone_lookups insert failed", {
        error: error.message,
        code: error.code,
      });
    }
  } catch (err) {
    logger.error("Failed to store phone lookups", { error: String(err) });
  }
}

// Increment daily check stats (fire-and-forget)
export async function incrementStats(
  verdict: string,
  region: string | null
): Promise<void> {
  try {
    const supabase = createServiceClient();
    if (!supabase) {
      logger.warn("incrementStats: Supabase service client is null — skipping");
      return;
    }

    const safeRegion = region || "__unknown__";

    const { error } = await supabase.rpc("increment_check_stats", {
      p_verdict: verdict,
      p_region: safeRegion,
    });

    if (error) {
      logger.error("increment_check_stats RPC failed", {
        error: error.message,
        code: error.code,
        verdict,
        region: safeRegion,
      });
    }
  } catch (err) {
    logger.error("Failed to increment stats", { error: String(err) });
  }
}
