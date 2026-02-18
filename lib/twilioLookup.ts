import Twilio from "twilio";
import { logger } from "./logger";

export interface PhoneLookupResult {
  valid: boolean;
  phoneNumber: string; // E.164 format
  countryCode: string | null;
  nationalFormat: string | null;
  lineType: string | null; // "mobile" | "landline" | "nonFixedVoip" | "tollFree" | ...
  carrier: string | null;
  isVoip: boolean;
  riskFlags: string[];
}

let _client: ReturnType<typeof Twilio> | null = null;

function getClient() {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio credentials not configured");
  _client = Twilio(sid, token);
  return _client;
}

/**
 * Look up a phone number via Twilio Lookup v2.
 * Basic validation = free. Line type intelligence = $0.008/lookup.
 */
export async function lookupPhoneNumber(phoneNumber: string): Promise<PhoneLookupResult> {
  const client = getClient();

  try {
    const result = await client.lookups.v2
      .phoneNumbers(phoneNumber)
      .fetch({ fields: "line_type_intelligence", countryCode: "AU" });

    const lineType = result.lineTypeIntelligence?.type ?? null;
    const carrier = result.lineTypeIntelligence?.carrierName ?? null;
    const isVoip = lineType === "nonFixedVoip";

    const riskFlags: string[] = [];
    if (isVoip) riskFlags.push("voip");
    if (!result.valid) riskFlags.push("invalid_number");
    if (result.countryCode && result.countryCode !== "AU") riskFlags.push("non_au_origin");
    if (!carrier) riskFlags.push("unknown_carrier");

    return {
      valid: result.valid ?? false,
      phoneNumber: result.phoneNumber ?? phoneNumber,
      countryCode: result.countryCode ?? null,
      nationalFormat: result.nationalFormat ?? null,
      lineType,
      carrier,
      isVoip,
      riskFlags,
    };
  } catch (err) {
    logger.error("Twilio lookup failed", { phone: phoneNumber.slice(-4), error: String(err) });
    return {
      valid: false,
      phoneNumber,
      countryCode: null,
      nationalFormat: null,
      lineType: null,
      carrier: null,
      isVoip: false,
      riskFlags: ["lookup_failed"],
    };
  }
}

/**
 * Extract Australian phone numbers from a transcript.
 * Returns deduplicated list with E.164 conversion.
 */
export function extractPhoneNumbers(
  transcript: string
): Array<{ original: string; e164: string | null }> {
  const patterns = [
    /\+\d{10,15}/g, // International E.164
    /\b0[45]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g, // AU mobile: 04xx/05xx xxx xxx
    /\b\(?0[2378]\)?[\s.-]?\d{4}[\s.-]?\d{4}\b/g, // AU landline: (0x) xxxx xxxx
    /\b(?:13\d{4}|1300[\s.-]?\d{3}[\s.-]?\d{3}|1800[\s.-]?\d{3}[\s.-]?\d{3})\b/g, // AU toll-free/local rate
  ];

  const seen = new Set<string>();
  const results: Array<{ original: string; e164: string | null }> = [];

  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(transcript)) !== null) {
      const cleaned = match[0].replace(/[\s.\-()]/g, "");
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);

      let e164: string | null = null;
      if (/^\+61\d{9}$/.test(cleaned)) e164 = cleaned;
      else if (/^0[2-578]\d{8}$/.test(cleaned)) e164 = `+61${cleaned.slice(1)}`;
      // 13/1300/1800 numbers don't have E.164 equivalents — skip Twilio lookup

      results.push({ original: match[0], e164 });
    }
  }

  return results;
}
