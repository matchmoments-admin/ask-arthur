import { inngest } from "@askarthur/scam-engine/inngest/client";
import {
  CLONE_WATCH_SCAN_REQUESTED_EVENT,
  parseCloneWatchScanRequestedData,
} from "@askarthur/scam-engine/inngest/events";
import {
  submitURLScan,
  retrieveURLScan,
  type URLScanResult,
} from "@askarthur/scam-engine/urlscan";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

/**
 * Phase A.3 — auto-scan a clone-watch candidate via urlscan.io and persist
 * the screenshot + auto-classification.
 *
 * Wait time: 60s between submit + retrieve. urlscan's typical scan latency
 * is 20-40s; 60s gives headroom. If the retrieve 404s (scan still in
 * progress), we wait another 30s and try once more. If still null after
 * the retry, skip persistence — the daily re-scan cron will pick it up
 * tomorrow. We do NOT auto-classify-as-unresolved on retry exhaustion
 * (ultrareview F4) because that would be gameable by deliberately
 * slow-rendering attackers.
 *
 * Classification heuristics (conservative — auto-triage only on
 * unambiguous + low-impact evidence; high-impact transitions stay manual):
 *   - effectiveUrl matches Afternic / Sedo / Dan.com / ... → parked_for_sale
 *     → auto-triage to needs_investigation (squat, re-watch periodically)
 *   - effectiveUrl empty                                    → unresolved
 *     → auto-triage to needs_investigation (worth re-scanning)
 *   - urlscan verdicts.malicious === true                   → likely_phishing
 *     → NO auto-triage (ultrareview F5) — the chip is shown in the admin
 *       dashboard prominently (rose-red) so the operator confirms TP
 *       themselves, which emits shopfront/clone.triaged.v1 and fans out to
 *       Netcraft submit + brand notify. Auto-flipping triage_status would
 *       hide the row from the pending queue AND skip the event emit, so
 *       the row becomes invisible and inert.
 *   - else                                                  → neutral
 *     → leave triage state alone
 *
 * **Inngest function ID `shopfront-clone-urlscan` is load-bearing** —
 * renaming it orphans in-flight runs (60-90s `step.sleep` between submit
 * and retrieve makes orphan windows real). Same for the rescan fn.
 * Coordinate any rename via a feature flag transition.
 *
 * See docs/plans/clone-watch-outreach.md §15 Phase A.3.
 */

const SCAN_WAIT_MS = 60_000;
const SCAN_RETRY_WAIT_MS = 30_000;

// Effective URLs in these hosts → parked-for-sale.
// Match by hostname-contains so subdomain variants are caught.
const PARKED_HOST_PATTERNS = [
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
];

export const cloneWatchUrlscan = inngest.createFunction(
  {
    id: "shopfront-clone-urlscan",
    name: "Clone-Watch: Auto-scan via urlscan.io",
    retries: 2,
    // One scan at a time — urlscan free tier is rate-limited; concurrency
    // overlap could trigger throttling.
    concurrency: { limit: 3 },
    // Idempotency on event.id (not event.data.alertId) so rescans of the
    // same alert next day actually run (initial-scan event id is stable
    // per alert; rescan emits with a unique timestamped id, so they DO
    // differ at event.id level). Fixes ultrareview F1.
    idempotency: "event.id",
    // Hard cap matches sleep budget + buffer
    timeouts: { finish: "5m" },
  },
  { event: CLONE_WATCH_SCAN_REQUESTED_EVENT },
  async ({ event, step }) => {
    const data = parseCloneWatchScanRequestedData(event.data);

    if (!featureFlags.shopfrontCloneUrlscan) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_URLSCAN disabled" };
    }
    if (!process.env.URLSCAN_API_KEY) {
      logger.warn("clone-watch urlscan: URLSCAN_API_KEY not set");
      return { skipped: true, reason: "URLSCAN_API_KEY not set" };
    }

    const sb = createServiceClient();
    if (!sb) return { skipped: true, reason: "supabase_unavailable" };

    // Submit the scan
    const submission = await step.run("submit-urlscan", async () => {
      return submitURLScan(data.candidateUrl);
    });
    if (!submission) {
      return { skipped: true, reason: "submit_failed" };
    }

    // urlscan needs ~30-60s to render the page + analyse
    await step.sleep("wait-for-scan", SCAN_WAIT_MS);

    let result = await step.run("retrieve-urlscan", async () => {
      return retrieveURLScan(submission.uuid);
    });
    if (!result) {
      // Scan still in progress — wait once more, then give up
      await step.sleep("wait-for-scan-retry", SCAN_RETRY_WAIT_MS);
      result = await step.run("retrieve-urlscan-retry", async () => {
        return retrieveURLScan(submission.uuid);
      });
    }

    // Both retrievals failed → don't auto-classify as 'unresolved' (which
    // would be triage-promoted to needs_investigation). An attacker can
    // deliberately slow-render to game the auto-classifier. Skip
    // persistence; the daily rescan cron retries tomorrow.
    // Fixes ultrareview F4.
    if (!result) {
      logger.warn("clone-watch urlscan: both retrievals returned null", {
        alertId: data.alertId,
        urlscanUuid: submission.uuid,
      });
      return {
        skipped: true,
        reason: "scan_timeout_both_retrievals_null",
        alertId: data.alertId,
        urlscanUuid: submission.uuid,
      };
    }

    const classification = classifyScan(result);
    const triageSuggestion = suggestTriageTransition(classification);

    await step.run("persist", async () => {
      await sb.rpc("persist_clone_alert_urlscan", {
        p_alert_id: data.alertId,
        p_urlscan_uuid: submission.uuid,
        p_urlscan_evidence: serialiseEvidence(submission.uuid, result),
        p_classification: classification,
        p_set_triage_status: triageSuggestion,
      });
    });

    await step.run("log-cost", async () => {
      logCost({
        feature: "shopfront_clone_urlscan",
        provider: "urlscan",
        operation: data.reason === "rescan" ? "rescan" : "scan",
        units: 1,
        unitCostUsd: 0, // free tier
        metadata: {
          alert_id: data.alertId,
          candidate_domain: data.candidateDomain,
          urlscan_uuid: submission.uuid,
          classification,
          triage_suggestion: triageSuggestion,
          had_result: result !== null,
        },
      });
    });

    logger.info("clone-watch urlscan: complete", {
      alertId: data.alertId,
      urlscanUuid: submission.uuid,
      classification,
      triageSuggestion,
    });

    return {
      ok: true,
      alertId: data.alertId,
      urlscanUuid: submission.uuid,
      classification,
      triageSuggestion,
    };
  },
);

// ── Pure helpers (exported for testing) ─────────────────────────────────

export type UrlscanClassification =
  | "parked_for_sale"
  | "unresolved"
  | "likely_phishing"
  | "neutral";

/**
 * Auto-classify a urlscan result. Conservative: only set
 * 'likely_phishing' when urlscan's own classifier is confident.
 */
export function classifyScan(
  result: URLScanResult | null,
): UrlscanClassification {
  // Scan didn't return a result OR effective URL empty → unresolved
  if (!result || !result.effectiveUrl) {
    return "unresolved";
  }

  // Parked-on-marketplace detection — match the effective URL's host.
  // Use suffix match (not substring) so an attacker-controlled host like
  // `evilafternic.com.attacker.com` does NOT match `afternic.com`.
  // Fixes ultrareview F8.
  const host = safeHostOf(result.effectiveUrl);
  if (host && PARKED_HOST_PATTERNS.some((p) => host === p || host.endsWith("." + p))) {
    return "parked_for_sale";
  }

  // urlscan's own classifier says malicious — high confidence
  if (result.malicious) {
    return "likely_phishing";
  }

  // Resolves to something we can't auto-classify — human review
  return "neutral";
}

/**
 * Map a classification to a triage_status transition suggestion.
 * Returns null when no transition is appropriate (leave the row alone).
 *
 * `likely_phishing` deliberately returns NULL (ultrareview F5):
 * - Auto-flipping to `tp_confirmed` would drop the row off the pending
 *   queue (it's filtered to pending-only) so the operator never sees the
 *   rose-red chip.
 * - It also wouldn't emit `shopfront/clone.triaged.v1`, so the downstream
 *   Netcraft-submit + brand-notify consumers never fire.
 * - Net effect: row becomes invisible + inert. Bad.
 * Instead, the chip surfaces in the dashboard; operator manually confirms
 * TP, which DOES emit the event and fans out correctly.
 *
 * `parked_for_sale` + `unresolved` → `needs_investigation` is safe because
 * those rows aren't actionable signals — moving them off the pending queue
 * is desirable. The chip + screenshot stay queryable from the admin page.
 *
 * The DB RPC (persist_clone_alert_urlscan) refuses to demote already-
 * triaged rows, so this can be safely conservative here.
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

function safeHostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function serialiseEvidence(
  uuid: string,
  result: URLScanResult | null,
): Record<string, unknown> {
  if (!result) {
    return {
      uuid,
      retrieved: false,
      scanned_at: new Date().toISOString(),
    };
  }
  return {
    uuid,
    retrieved: true,
    scanned_at: new Date().toISOString(),
    screenshot_url: result.screenshotUrl,
    effective_url: result.effectiveUrl,
    malicious: result.malicious,
    score: result.score,
    categories: result.categories.slice(0, 10),
    technologies: result.technologies.slice(0, 15),
    server: result.serverInfo,
  };
}

export { PARKED_HOST_PATTERNS };
