// Re-export from @askarthur/scam-engine — the canonical implementation now
// lives in the scam-engine package so both web (real-time) and enrichment
// pipeline (background) can use it.

export {
  lookupPhoneNumber,
  extractPhoneNumbers,
  computePhoneRiskScore,
} from "@askarthur/scam-engine/twilio-lookup";

export type { PhoneLookupResult } from "@askarthur/types";
