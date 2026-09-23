// Shared I/O for submitting ONE clone-watch candidate to the urlscan pipeline:
//   reputation (Safe Browsing + VirusTotal) → urlscan submit → record UUID.
// Used by both the gated batch cron (clone-watch-urlscan-submit) and the
// single-candidate admin/operator path (clone-watch-urlscan-scan-one).
//
// Side-effecting (external APIs + DB writes), so it lives here rather than in
// the pure urlscan-classify module. Each caller wraps it in its own step.run.

import { submitURLScanWithDetails } from "@askarthur/scam-engine/urlscan";
import { checkURLReputation } from "@askarthur/scam-engine";
import { createServiceClient } from "@askarthur/supabase/server";
import { resolvesToHost } from "@/lib/clone-watch/liveness";
import {
  serialiseSubmitEvidence,
  serialiseSubmitFailure,
  type ReputationVerdict,
} from "@/lib/clone-watch/urlscan-classify";

export interface CloneCandidate {
  id: number;
  candidate_url: string;
  candidate_domain: string;
}

export interface SubmitOutcome {
  kind:
    | "submitted"
    | "reputation_classified"
    // Distinct from submit_failed on purpose: a 429 is OUR quota, not a fact
    // about the URL, and it leaves the row untouched. Collapsing the two hid
    // rate-limiting inside a "failures" counter, which is why "have we ever been
    // 429'd?" was unanswerable — the guard below returns before any DB write, so
    // the row carries no trace either.
    | "rate_limited"
    // DNS precheck proved the name points at no host: urlscan + reputation
    // were NOT called (the saving). Stamped like urlscan's 400 so the v277
    // dead-domain cadence applies; counted apart from real submit failures.
    | "dns_no_host"
    | "submit_failed"
    | "no_client";
  reputationMalicious: boolean;
  error?: string;
}

/**
 * Reputation-check + urlscan-submit a single candidate, then persist the
 * outcome. Does NOT classify on the urlscan render — that's the retrieve
 * stage's job. The only place this sets a classification is the
 * submit-failed-but-reputation-malicious corner, where urlscan is unavailable
 * yet SB/VT already gave a decisive verdict.
 */
/** Recorded instead of a urlscan call when DNS proves the name points at no
 *  host (no A, no AAAA). Status 400 on purpose: it is exactly what urlscan
 *  returns for a no-DNS domain, so the v277 dead-domain cadence
 *  (`urlscan_evidence->>'status' = '400'`) treats both identically; `error`
 *  distinguishes who decided. Rows stamped before PR B (3 in prod) carry the
 *  old value `dns_nxdomain_precheck`. */
export const DNS_PRECHECK_ERROR = "dns_no_host_precheck";

export async function submitCloneCandidate(
  candidate: CloneCandidate,
): Promise<SubmitOutcome> {
  const sb = createServiceClient();
  if (!sb) return { kind: "no_client", reputationMalicious: false };

  // DNS precheck (2026-09-23). ~47% of daily submits and ~23% of rechecks were
  // urlscan "400 DNS Error - Could not resolve domain" — each also paying a
  // Safe Browsing/VirusTotal lookup and holding a concurrency slot. A name that
  // PROVABLY points at no host (no A and no AAAA — including a zone still
  // delegated with its A removed) skips; an inconclusive resolver answer falls
  // through to the scan exactly as before.
  const host = await resolvesToHost(candidate.candidate_domain);
  if (host === false) {
    const nowIso = new Date().toISOString();
    const { error } = await sb.rpc("record_clone_alert_urlscan_submit", {
      p_alert_id: candidate.id,
      p_urlscan_uuid: null,
      p_evidence: serialiseSubmitFailure(
        DNS_PRECHECK_ERROR,
        400,
        { isMalicious: false, sources: [] },
        nowIso,
        "DNS precheck: no A and no AAAA record — not submitted to urlscan",
      ),
    });
    if (error) throw new Error(`record dns precheck failed: ${error.message}`);
    return {
      kind: "dns_no_host",
      reputationMalicious: false,
      error: DNS_PRECHECK_ERROR,
    };
  }

  const repResults = await checkURLReputation([candidate.candidate_url]);
  const reputation: ReputationVerdict = {
    isMalicious: repResults[0]?.isMalicious ?? false,
    sources: repResults[0]?.sources ?? [],
  };

  const submission = await submitURLScanWithDetails(candidate.candidate_url);
  const nowIso = new Date().toISOString();

  if (submission.ok) {
    const { error } = await sb.rpc("record_clone_alert_urlscan_submit", {
      p_alert_id: candidate.id,
      p_urlscan_uuid: submission.uuid,
      p_evidence: serialiseSubmitEvidence(submission.uuid, reputation, nowIso),
    });
    if (error) throw new Error(`record scan submission failed: ${error.message}`);
    return { kind: "submitted", reputationMalicious: reputation.isMalicious };
  }

  // Submit failed. Reputation hit is decisive even without urlscan.
  if (reputation.isMalicious) {
    const { error } = await sb.rpc("persist_clone_alert_urlscan", {
      p_alert_id: candidate.id,
      p_urlscan_uuid: null,
      p_urlscan_evidence: serialiseSubmitFailure(
        submission.error,
        submission.status ?? null,
        reputation,
        nowIso,
        submission.message,
      ),
      p_classification: "likely_phishing",
      p_set_triage_status: null, // operator confirms TP (ultrareview F5)
    });
    // v307 applies the lifecycle in the same transaction as the verdict.
    if (error) throw new Error(`persist reputation verdict failed: ${error.message}`);
    return { kind: "reputation_classified", reputationMalicious: true };
  }

  // Quota exhaustion is NOT URL death — a 429 (rate_limited) must not bump
  // urlscan_failure_streak, or three unlucky rate-limited windows would age a
  // live, never-actually-scanned clone out of both the submit and retrieve
  // gates (v224 ops-review finding: 24 rows were mis-flagged this way). Leave
  // the row untouched so the next cadence retries it.
  if (submission.status === 429) {
    return {
      kind: "rate_limited",
      reputationMalicious: false,
      error: submission.error,
    };
  }

  // No reputation hit + genuine submit failure → record it (bumps
  // urlscan_failure_streak so it ages out of the gate after the cap).
  const { error } = await sb.rpc("record_clone_alert_urlscan_submit", {
    p_alert_id: candidate.id,
    p_urlscan_uuid: null,
    p_evidence: serialiseSubmitFailure(
      submission.error,
      submission.status ?? null,
      reputation,
      nowIso,
      submission.message,
    ),
  });
  if (error) throw new Error(`record scan failure failed: ${error.message}`);
  return {
    kind: "submit_failed",
    reputationMalicious: false,
    error: submission.error,
  };
}

/** What a batch of submits added up to. The ONE mapping from `SubmitOutcome`
 *  to lane counters — the submit and recheck lanes used to keep their own, and
 *  the recheck copy counted a 429 as a failure, so a quota day paged the
 *  health digest as "silent zero" (2026-09-24). */
export interface SubmitTally {
  /** Submitted to urlscan, or classified by reputation when the submit failed. */
  submitted: number;
  /** urlscan 429 — OUR quota. Not a failure, row untouched, not in attemptedIds. */
  rateLimited: number;
  /** DNS precheck proved no host; no urlscan call. */
  dnsSkipped: number;
  /** Genuine submit failure, no client, or a thrown row. */
  submitFailed: number;
  reputationHits: number;
  /** Every row the loop looked at EXCEPT a 429 — "we looked", which is what
   *  the recheck cadence stamp records (see clone-watch-lifecycle-recheck). */
  attemptedIds: number[];
  /** Rows the budget stopped the loop before reaching; they re-present next run. */
  unreached: number;
}

/**
 * Submit candidates sequentially until `budget.expired()`. Runs INSIDE the
 * caller's single budgeted step — it never awaits step.run per item, so the
 * budget is in-step and a replay cannot reset the tally mid-loop. One row's
 * throw is counted and logged via `onRowError`, never aborts the rest.
 */
export async function submitCandidateBatch(
  candidates: readonly CloneCandidate[],
  budget: { expired(): boolean },
  opts: {
    onRowError?: (id: number, err: unknown) => void;
    submitOne?: (c: CloneCandidate) => Promise<SubmitOutcome>;
  } = {},
): Promise<SubmitTally> {
  const submitOne = opts.submitOne ?? submitCloneCandidate;
  const tally: SubmitTally = {
    submitted: 0,
    rateLimited: 0,
    dnsSkipped: 0,
    submitFailed: 0,
    reputationHits: 0,
    attemptedIds: [],
    unreached: 0,
  };
  let reached = 0;
  for (const c of candidates) {
    if (budget.expired()) break;
    reached++;
    try {
      const outcome = await submitOne({
        id: c.id,
        candidate_url: c.candidate_url,
        candidate_domain: c.candidate_domain,
      });
      if (outcome.reputationMalicious) tally.reputationHits++;
      switch (outcome.kind) {
        case "submitted":
        case "reputation_classified":
          tally.submitted++;
          break;
        case "rate_limited":
          tally.rateLimited++;
          continue; // not attempted: leave it unstamped so it retries first
        case "dns_no_host":
          tally.dnsSkipped++;
          break;
        default:
          tally.submitFailed++;
      }
      tally.attemptedIds.push(c.id);
    } catch (err) {
      tally.submitFailed++;
      tally.attemptedIds.push(c.id);
      opts.onRowError?.(c.id, err);
    }
  }
  tally.unreached = candidates.length - reached;
  return tally;
}
