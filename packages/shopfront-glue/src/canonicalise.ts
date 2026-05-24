// Canonical URL form for shopfront_clone_alerts.candidate_url + url_hash.
// All clone-watch writers (Layer 0 NRD, Phase A corpus match, Phase B
// CT firehose) MUST go through canonicaliseCandidateUrl so that
// uniq_clone_alerts_target_url dedupes the same domain to the same row
// regardless of which signal source observed it first.
//
// NOTE: an earlier draft of this contract claimed to drive cross-surface
// dedupe against `brand_impersonation_alerts.candidate_url` — but that
// column does not exist on that table (it has `scammer_urls TEXT[]`).
// The cross-surface dedupe step has been dropped from MVP scope. If
// Layer 0's bank/telco overlap with ct-monitor.ts produces meaningful
// duplicate noise during the 7-day evidence window, we add a
// `candidate_url` column to `brand_impersonation_alerts` in a follow-up
// migration and reintroduce the dedupe step then.

import { sha256Hex } from "@askarthur/utils/hash";

const TRAILING_DOT = /\.$/;

export function canonicaliseCandidateUrl(domain: string): string {
  const trimmed = domain.trim().toLowerCase().replace(TRAILING_DOT, "");
  return `https://${trimmed}/`;
}

export function urlHash(candidateUrl: string): Promise<string> {
  return sha256Hex(candidateUrl);
}
