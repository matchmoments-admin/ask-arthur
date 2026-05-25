import { inngest } from "@askarthur/scam-engine/inngest/client";
import {
  CLONE_WATCH_SCAN_REQUESTED_EVENT,
  type CloneWatchScanRequestedData,
} from "@askarthur/scam-engine/inngest/events";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

/**
 * Phase A.3 — daily re-scan cron for clone-watch candidates.
 *
 * Catches the seasoning-attacker pattern: a typosquat registered + parked
 * on day 1, then activated as a live phishing page 7-30 days later. The
 * initial auto-scan flagged it `parked_for_sale` (→ needs_investigation);
 * the re-scan catches the transition + flips to likely_phishing.
 *
 * Re-fans-out via the same shopfront/clone.scan-requested.v1 event the
 * initial scan uses, so the actual scan + classify + persist logic lives
 * once in clone-watch-urlscan.
 *
 * Cron: 09:00 UTC daily (after the 08:30 NRD ingest settles). Stale-after
 * threshold: 24h. Budget: 50 re-scans per run (within urlscan free tier
 * 100/day, leaving headroom for the initial-scan path).
 */

const RESCAN_BATCH_LIMIT = 50;
const STALE_AFTER_HOURS = 24;

interface RescanRow {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string;
  previous_classification: string | null;
  last_scanned_at: string;
}

export const cloneWatchUrlscanRescan = inngest.createFunction(
  {
    id: "shopfront-clone-urlscan-rescan",
    name: "Clone-Watch: Daily urlscan re-scan",
    retries: 1,
    concurrency: { limit: 1 },
    timeouts: { finish: "5m" },
  },
  [
    { cron: "0 9 * * *" },
    { event: "shopfront/clone.urlscan-rescan.manual-trigger.v1" },
  ],
  async ({ step }) => {
    if (!featureFlags.shopfrontCloneUrlscan) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_URLSCAN disabled" };
    }

    const sb = createServiceClient();
    if (!sb) return { skipped: true, reason: "supabase_unavailable" };

    const rows = await step.run("load-rescan-candidates", async () => {
      const { data } = await sb.rpc("list_clone_alerts_for_urlscan_rescan", {
        p_limit: RESCAN_BATCH_LIMIT,
        p_stale_after_hours: STALE_AFTER_HOURS,
      });
      return (data as RescanRow[] | null) ?? [];
    });

    if (rows.length === 0) {
      return { ok: true, fanned_out: 0, reason: "no_stale_rows" };
    }

    await step.run("fan-out-rescans", async () => {
      const events = rows.map((r) => ({
        name: CLONE_WATCH_SCAN_REQUESTED_EVENT,
        // New event id per rescan so the per-fn idempotency on alertId
        // is bypassed (initial scan already used the bare alertId).
        id: `clone-watch-urlscan-rescan:${r.id}:${Date.now()}`,
        data: {
          alertId: r.id,
          candidateUrl: r.candidate_url,
          candidateDomain: r.candidate_domain,
          reason: "rescan",
        } satisfies CloneWatchScanRequestedData,
      }));
      await inngest.send(events);
    });

    await step.run("log-cost", async () => {
      logCost({
        feature: "shopfront_clone_urlscan_rescan",
        provider: "urlscan",
        operation: "fan_out_rescans",
        units: rows.length,
        unitCostUsd: 0, // each rescan is logged separately by clone-watch-urlscan
        metadata: {
          fanned_out: rows.length,
          batch_limit: RESCAN_BATCH_LIMIT,
          stale_after_hours: STALE_AFTER_HOURS,
        },
      });
    });

    logger.info("clone-watch urlscan rescan: fan-out complete", {
      fanned_out: rows.length,
    });

    return { ok: true, fanned_out: rows.length };
  },
);
