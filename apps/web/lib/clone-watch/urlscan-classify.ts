// Pure classification + evidence-serialisation helpers for the clone-watch
// urlscan pipeline. Extracted from the old per-candidate monolith
// (clone-watch-urlscan.ts, removed in the async rebuild) so both the submit
// and retrieve stages share one copy. No I/O — all functions are pure and
// unit-tested in __tests__/urlscan-classify.test.ts.

import type { URLScanResult } from "@askarthur/scam-engine/urlscan";

export type UrlscanClassification =
  | "parked_for_sale"
  | "unresolved"
  | "likely_phishing"
  | "neutral";

/** Reputation verdict captured synchronously at submit time (Safe Browsing +
 *  VirusTotal via checkURLReputation). Stored in urlscan_evidence.reputation
 *  so the retrieve stage can merge it with the urlscan render. */
export interface ReputationVerdict {
  isMalicious: boolean;
  sources: string[];
}

// Effective URLs in these hosts → parked-for-sale. Match by suffix (host ===
// p OR host endsWith "." + p) so `evilafternic.com.attacker.com` does NOT
// match `afternic.com` (ultrareview F8).
export const PARKED_HOST_PATTERNS = [
  "afternic.com",
  "sedo.com",
  "sedoparking.com",
  "dan.com",
  "parkingcrew.net",
  "bodis.com",
  "uniregistry.com",
  "undeveloped.com",
  "domainmarket.com",
  "namebright.com",
] as const;

/**
 * Auto-classify from the urlscan render + the SB/VT reputation verdict.
 * Conservative: only `likely_phishing` on unambiguous evidence.
 *
 * Reputation precedence: a Safe Browsing / VirusTotal hit is high-confidence
 * on its own, so it wins even before the urlscan render is considered (and
 * lets the retrieve stage classify a candidate whose urlscan never completes).
 */
export function classifyScan(
  result: URLScanResult | null,
  reputationMalicious = false,
): UrlscanClassification {
  // Known-bad per Safe Browsing / VirusTotal — decisive.
  if (reputationMalicious) return "likely_phishing";

  // No render (or empty effective URL) and no reputation hit → unresolved.
  if (!result || !result.effectiveUrl) return "unresolved";

  const host = safeHostOf(result.effectiveUrl);
  if (host && PARKED_HOST_PATTERNS.some((p) => host === p || host.endsWith("." + p))) {
    return "parked_for_sale";
  }

  // urlscan's own classifier flagged it.
  if (result.malicious) return "likely_phishing";

  return "neutral";
}

/**
 * Map a classification to a triage_status transition suggestion (null = leave
 * the row alone). `likely_phishing` deliberately returns null: auto-flipping
 * to tp_confirmed would drop the row off the pending queue AND skip the
 * shopfront/clone.triaged.v1 emit, making it invisible + inert (ultrareview
 * F5). The operator confirms TP manually, which fans out to Netcraft + notify.
 */
export function suggestTriageTransition(
  classification: UrlscanClassification,
): "needs_investigation" | null {
  switch (classification) {
    case "parked_for_sale":
    case "unresolved":
      return "needs_investigation";
    case "likely_phishing":
    case "neutral":
      return null;
  }
}

export function safeHostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

// ── Evidence serialisers (the jsonb persisted to urlscan_evidence) ──────────

/** Submit-time record: the urlscan UUID we're now awaiting + the synchronous
 *  SB/VT reputation verdict. The retrieve stage reads `reputation` back. */
export function serialiseSubmitEvidence(
  uuid: string,
  reputation: ReputationVerdict,
  submittedAt: string,
): Record<string, unknown> {
  return {
    stage: "submitted",
    uuid,
    submitted_at: submittedAt,
    retrieved: false,
    reputation: { is_malicious: reputation.isMalicious, sources: reputation.sources },
  };
}

/** Submit FAILED (urlscan rejected / network error). Reputation may still be
 *  present and decisive. */
export function serialiseSubmitFailure(
  error: string,
  status: number | null,
  reputation: ReputationVerdict,
  attemptedAt: string,
): Record<string, unknown> {
  return {
    stage: "submit_failed",
    submit_failed: true,
    error,
    status,
    attempted_at: attemptedAt,
    reputation: { is_malicious: reputation.isMalicious, sources: reputation.sources },
  };
}

/** Retrieve succeeded — full evidence, carrying the prior reputation forward. */
export function serialiseRetrievedEvidence(
  uuid: string,
  result: URLScanResult,
  reputation: ReputationVerdict,
  scannedAt: string,
): Record<string, unknown> {
  return {
    stage: "retrieved",
    uuid,
    retrieved: true,
    scanned_at: scannedAt,
    screenshot_url: result.screenshotUrl,
    effective_url: result.effectiveUrl,
    malicious: result.malicious,
    score: result.score,
    categories: result.categories.slice(0, 10),
    technologies: result.technologies.slice(0, 15),
    server: result.serverInfo,
    reputation: { is_malicious: reputation.isMalicious, sources: reputation.sources },
  };
}

/** Retrieve attempt returned null (scan still rendering). Carries reputation +
 *  uuid forward so a later tick (or the reputation-only fallback) still has them. */
export function serialiseRetrievalPending(
  uuid: string,
  reputation: ReputationVerdict,
  attemptedAt: string,
): Record<string, unknown> {
  return {
    stage: "retrieve_pending",
    uuid,
    retrieved: false,
    last_attempt_at: attemptedAt,
    reputation: { is_malicious: reputation.isMalicious, sources: reputation.sources },
  };
}

/** Pull the stored reputation verdict back out of urlscan_evidence (written at
 *  submit time). Defensive against missing/legacy shapes. */
export function reputationFromEvidence(
  evidence: unknown,
): ReputationVerdict {
  const rep = (evidence as { reputation?: unknown } | null)?.reputation as
    | { is_malicious?: unknown; sources?: unknown }
    | undefined;
  return {
    isMalicious: rep?.is_malicious === true,
    sources: Array.isArray(rep?.sources)
      ? (rep!.sources as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
  };
}
