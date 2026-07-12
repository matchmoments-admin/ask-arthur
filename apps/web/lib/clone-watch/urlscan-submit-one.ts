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
  kind: "submitted" | "reputation_classified" | "submit_failed" | "no_client";
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
export async function submitCloneCandidate(
  candidate: CloneCandidate,
): Promise<SubmitOutcome> {
  const sb = createServiceClient();
  if (!sb) return { kind: "no_client", reputationMalicious: false };

  const repResults = await checkURLReputation([candidate.candidate_url]);
  const reputation: ReputationVerdict = {
    isMalicious: repResults[0]?.isMalicious ?? false,
    sources: repResults[0]?.sources ?? [],
  };

  const submission = await submitURLScanWithDetails(candidate.candidate_url);
  const nowIso = new Date().toISOString();

  if (submission.ok) {
    await sb.rpc("record_clone_alert_urlscan_submit", {
      p_alert_id: candidate.id,
      p_urlscan_uuid: submission.uuid,
      p_evidence: serialiseSubmitEvidence(submission.uuid, reputation, nowIso),
    });
    return { kind: "submitted", reputationMalicious: reputation.isMalicious };
  }

  // Submit failed. Reputation hit is decisive even without urlscan.
  if (reputation.isMalicious) {
    await sb.rpc("persist_clone_alert_urlscan", {
      p_alert_id: candidate.id,
      p_urlscan_uuid: null,
      p_urlscan_evidence: serialiseSubmitFailure(
        submission.error,
        submission.status ?? null,
        reputation,
        nowIso,
      ),
      p_classification: "likely_phishing",
      p_set_triage_status: null, // operator confirms TP (ultrareview F5)
    });
    return { kind: "reputation_classified", reputationMalicious: true };
  }

  // Quota exhaustion is NOT URL death — a 429 (rate_limited) must not bump
  // urlscan_failure_streak, or three unlucky rate-limited windows would age a
  // live, never-actually-scanned clone out of both the submit and retrieve
  // gates (v224 ops-review finding: 24 rows were mis-flagged this way). Leave
  // the row untouched so the next cadence retries it.
  if (submission.status === 429) {
    return {
      kind: "submit_failed",
      reputationMalicious: false,
      error: submission.error,
    };
  }

  // No reputation hit + genuine submit failure → record it (bumps
  // urlscan_failure_streak so it ages out of the gate after the cap).
  await sb.rpc("record_clone_alert_urlscan_submit", {
    p_alert_id: candidate.id,
    p_urlscan_uuid: null,
    p_evidence: serialiseSubmitFailure(
      submission.error,
      submission.status ?? null,
      reputation,
      nowIso,
    ),
  });
  return {
    kind: "submit_failed",
    reputationMalicious: false,
    error: submission.error,
  };
}
