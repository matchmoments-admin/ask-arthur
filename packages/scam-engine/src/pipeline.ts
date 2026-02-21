import { createServiceClient } from "@askarthur/supabase/server";
import type { AnalysisResult, PhoneLookupResult } from "@askarthur/types";
import { logger } from "@askarthur/utils/logger";

type UploadScreenshotFn = (buffer: Buffer, contentType: string) => Promise<string | null>;

// PII patterns to scrub (defense in depth — Claude is also instructed not to echo PII)
// ORDER MATTERS: More specific patterns (card, Medicare, TFN) must run BEFORE the
// generic phone pattern, which is greedy and would otherwise consume their digits.
const PII_PATTERNS: [RegExp, string][] = [
  // Email addresses
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]"],
  // Credit card numbers (must run before generic phone)
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[CARD]"],
  // Australian Medicare number (XXXX XXXXX X) (must run before generic phone)
  [/\b\d{4}\s?\d{5}\s?\d\b/g, "[MEDICARE]"],
  // Australian Tax File Number (TFN: XXX XXX XXX) (must run before generic phone)
  [/\b\d{3}\s?\d{3}\s?\d{3}\b/g, "[TFN]"],
  // SSN (must run before generic phone)
  [/\b\d{3}-?\d{2}-?\d{4}\b/g, "[SSN]"],
  // Australian phone numbers (04xx xxx xxx, +614xx xxx xxx) (must run before generic phone)
  [/(\+?61\s?)?0?4\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g, "[AU_PHONE]"],
  // Australian landline (0x xxxx xxxx) (must run before generic phone)
  [/0[2-9]\s?\d{4}\s?\d{4}/g, "[AU_PHONE]"],
  // Phone numbers — generic catch-all (runs last among digit patterns)
  [/(\+?1?\s?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/g, "[PHONE]"],
  // IP addresses
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]"],
  // Australian BSB (XXX-XXX)
  [/\b\d{3}-\d{3}\b/g, "[BSB]"],
  // Street addresses (basic, AU and US)
  [/\b\d{1,5}\s+[A-Za-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Parade|Pde|Terrace|Tce|Highway|Hwy)\b/gi, "[ADDRESS]"],
  // Names after common prefixes
  [/\b(Dear|Hi|Hello|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)?\b/g, "[NAME]"],
];

export function scrubPII(text: string): string {
  let scrubbed = text;
  for (const [pattern, replacement] of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}

// Store a PII-scrubbed scam record for HIGH_RISK verdicts only
export async function storeVerifiedScam(
  analysis: AnalysisResult,
  region: string | null,
  imagesBase64?: string[],
  uploadScreenshot?: UploadScreenshotFn
): Promise<void> {
  try {
    const supabase = createServiceClient();
    if (!supabase) return; // no-op in local dev

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

    const { error } = await supabase.from("verified_scams").insert({
      scam_type: analysis.scamType || "other",
      channel: analysis.channel,
      summary: scrubbedSummary,
      red_flags: scrubbedFlags,
      region,
      confidence_score: analysis.confidence,
      impersonated_brand: analysis.impersonatedBrand,
      ...(screenshotKey && { screenshot_key: screenshotKey }),
    });

    if (error) {
      logger.error("verified_scams insert failed", {
        error: error.message,
        code: error.code,
      });
    }
  } catch (err) {
    logger.error("Failed to store verified scam", { error: String(err) });
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

// Only store last 3 digits + length indicator for privacy
function scrubPhoneForStorage(phone: string): string {
  if (phone.length < 4) return "***";
  return "*".repeat(phone.length - 3) + phone.slice(-3);
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
