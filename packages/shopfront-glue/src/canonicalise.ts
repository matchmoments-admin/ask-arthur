// Canonical URL form for shopfront_clone_alerts.candidate_url. Locked here
// because cross-surface dedupe against brand_impersonation_alerts.candidate_url
// requires both writers to agree on the same string form for the same domain.

import { sha256Hex } from "@askarthur/utils/hash";

const TRAILING_DOT = /\.$/;

export function canonicaliseCandidateUrl(domain: string): string {
  const trimmed = domain.trim().toLowerCase().replace(TRAILING_DOT, "");
  return `https://${trimmed}/`;
}

export function urlHash(candidateUrl: string): Promise<string> {
  return sha256Hex(candidateUrl);
}
