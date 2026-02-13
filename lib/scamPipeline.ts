import { createServiceClient } from "./supabase";
import { uploadScreenshot } from "./r2";
import type { AnalysisResult } from "./claude";
import { logger } from "./logger";

// PII patterns to scrub (defense in depth — Claude is also instructed not to echo PII)
const PII_PATTERNS: [RegExp, string][] = [
  // Email addresses
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]"],
  // Phone numbers (various formats including AU)
  [/(\+?1?\s?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/g, "[PHONE]"],
  // Australian phone numbers (04xx xxx xxx, +614xx xxx xxx)
  [/(\+?61\s?)?0?4\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g, "[AU_PHONE]"],
  // Australian landline (0x xxxx xxxx)
  [/0[2-9]\s?\d{4}\s?\d{4}/g, "[AU_PHONE]"],
  // SSN
  [/\b\d{3}-?\d{2}-?\d{4}\b/g, "[SSN]"],
  // Australian Tax File Number (TFN: XXX XXX XXX)
  [/\b\d{3}\s?\d{3}\s?\d{3}\b/g, "[TFN]"],
  // Australian Medicare number (XXXX XXXXX X)
  [/\b\d{4}\s?\d{5}\s?\d\b/g, "[MEDICARE]"],
  // Credit card numbers
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[CARD]"],
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
  imageBase64?: string
): Promise<void> {
  try {
    const supabase = createServiceClient();
    if (!supabase) return; // no-op in local dev

    const scrubbedSummary = scrubPII(analysis.summary);
    const scrubbedFlags = analysis.redFlags.map(scrubPII);

    // Upload screenshot to R2 if provided (fire-and-forget, non-blocking)
    let screenshotKey: string | null = null;
    if (imageBase64) {
      try {
        const buffer = Buffer.from(imageBase64, "base64");
        let contentType = "image/png";
        if (imageBase64.startsWith("/9j/")) contentType = "image/jpeg";
        else if (imageBase64.startsWith("R0lGOD")) contentType = "image/gif";
        else if (imageBase64.startsWith("UklGR")) contentType = "image/webp";
        screenshotKey = await uploadScreenshot(buffer, contentType);
      } catch (err) {
        logger.error("R2 upload failed (non-blocking)", { error: String(err) });
      }
    }

    await supabase.from("verified_scams").insert({
      scam_type: analysis.scamType || "other",
      channel: analysis.channel,
      summary: scrubbedSummary,
      red_flags: scrubbedFlags,
      region,
      confidence_score: analysis.confidence,
      impersonated_brand: analysis.impersonatedBrand,
      ...(screenshotKey && { screenshot_key: screenshotKey }),
    });
  } catch (err) {
    logger.error("Failed to store verified scam", { error: String(err) });
  }
}

// Increment daily check stats (fire-and-forget)
export async function incrementStats(
  verdict: string,
  region: string | null
): Promise<void> {
  try {
    const supabase = createServiceClient();
    if (!supabase) return; // no-op in local dev

    await supabase.rpc("increment_check_stats", {
      p_verdict: verdict,
      p_region: region,
    });
  } catch (err) {
    logger.error("Failed to increment stats", { error: String(err) });
  }
}
