import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

/**
 * Proactive onward-report producer (WS2 — "report on behalf of brands without
 * being asked").
 *
 * Hourly cron that sweeps recent HIGH_RISK scam_reports carrying a scammer URL
 * and enqueues onward reports to the enabled URL-blocklist destinations
 * (OpenPhish / APWG), then fires the report.onward.<destination> events the
 * existing workers consume. No human gate — auto-fire is acceptable for
 * neutral blocklists; safety comes from (a) HIGH_RISK + has-URL filter,
 * (b) the worker rate-limits (60/hr), (c) the onward_report_log dedup unique
 * index on (scam_report_id, destination, destination_key) so re-scanning the
 * lookback window never double-reports.
 *
 * Triple-gated:
 *   - FF_ONWARD_AUTO_REPORT  → whether the producer runs at all
 *   - FF_ONWARD_OPENPHISH    → whether openphish is an enqueued destination
 *   - FF_ONWARD_APWG         → whether apwg is an enqueued destination
 * The producer only enqueues destinations whose worker flag is ON, so no
 * skipped rows accrue for dark destinations.
 *
 * Path-independent: works whether scam_reports were written by the legacy
 * waitUntil path or the analyze.completed.v1 Inngest consumers.
 *
 * Bounded read: HIGH_RISK is a minority of scam_reports and we cap the
 * lookback + LIMIT, so this is a fast indexed read, not a hot-table scan.
 */

const LOOKBACK_HOURS = 24;
const CANDIDATE_LIMIT = 200;

export interface UrlBlocklistDestination {
  destination: "openphish" | "apwg";
  destinationKey: string;
}

const OPENPHISH: UrlBlocklistDestination = {
  destination: "openphish",
  destinationKey: "report@openphish.com",
};
const APWG: UrlBlocklistDestination = {
  destination: "apwg",
  destinationKey: "reportphishing@apwg.org",
};

/** Which URL-blocklist destinations are enabled by their per-destination flags. */
export function enabledUrlBlocklistDestinations(flags: {
  onwardOpenphish: boolean;
  onwardApwg: boolean;
}): UrlBlocklistDestination[] {
  const out: UrlBlocklistDestination[] = [];
  if (flags.onwardOpenphish) out.push(OPENPHISH);
  if (flags.onwardApwg) out.push(APWG);
  return out;
}

/** Extract scammer URLs from a scam_reports.analysis_result JSON blob. */
export function extractScammerUrls(analysisResult: unknown): string[] {
  if (!analysisResult || typeof analysisResult !== "object") return [];
  const ar = analysisResult as Record<string, unknown>;
  for (const key of ["scammerUrls", "scammer_urls"]) {
    const v = ar[key];
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string" && x.length > 0);
    }
  }
  return [];
}

interface CandidateRow {
  id: number;
  analysis_result: unknown;
}

export const onwardAutoReport = inngest.createFunction(
  {
    id: "report-onward-auto-report",
    singleton: { mode: "skip" },
    timeouts: { finish: "4m" },
    name: "Onward report: proactive auto-report producer",
    retries: 2,
  },
  { cron: "25 */3 * * *" }, // every 3h (PR-C, was hourly); :25 offset avoids cron pileup. 24h lookback + dedup index make the wider cadence lossless.
  async ({ step }) => {
    if (!featureFlags.onwardAutoReport) {
      return { skipped: true, reason: "FF_ONWARD_AUTO_REPORT disabled" };
    }

    const destinations = enabledUrlBlocklistDestinations(featureFlags);
    if (destinations.length === 0) {
      return { skipped: true, reason: "no_enabled_destinations" };
    }

    // Fetch recent HIGH_RISK candidates, then filter to those with a URL.
    const candidates = await step.run("fetch-candidates", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as CandidateRow[];
      const sinceIso = new Date(
        Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await sb
        .from("scam_reports")
        .select("id, analysis_result")
        .eq("verdict", "HIGH_RISK")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(CANDIDATE_LIMIT);
      if (error) {
        logger.error("onward-auto-report: candidate fetch failed", {
          error: error.message,
        });
        return [] as CandidateRow[];
      }
      return (data ?? []).filter(
        (r) => extractScammerUrls(r.analysis_result).length > 0,
      ) as CandidateRow[];
    });

    if (candidates.length === 0) {
      return { ok: true, candidates: 0, enqueued: 0 };
    }

    // Enqueue onward_report_log rows (dedup via the v119 unique index) and
    // collect the freshly-inserted (log_id, scam_report_id, destination) so we
    // only fire events for genuinely-new reports.
    const fresh = await step.run("enqueue-rows", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as Array<{
        log_id: string;
        scam_report_id: number;
        destination: string;
        destination_key: string;
      }>;
      const rows = candidates.flatMap((c) =>
        destinations.map((d) => ({
          scam_report_id: c.id,
          destination: d.destination,
          destination_key: d.destinationKey,
          status: "queued",
          provider: "inngest",
        })),
      );
      // ignoreDuplicates → conflicting (already-reported) rows are skipped and
      // NOT returned, so `inserted` is exactly the new work.
      const { data: inserted, error } = await sb
        .from("onward_report_log")
        .upsert(rows, {
          onConflict: "scam_report_id,destination,destination_key",
          ignoreDuplicates: true,
        })
        .select("id, scam_report_id, destination, destination_key");
      if (error) {
        logger.error("onward-auto-report: enqueue failed", {
          error: error.message,
        });
        return [];
      }
      return (inserted ?? []).map((r) => ({
        log_id: r.id as string,
        scam_report_id: r.scam_report_id as number,
        destination: r.destination as string,
        destination_key: r.destination_key as string,
      }));
    });

    if (fresh.length === 0) {
      return { ok: true, candidates: candidates.length, enqueued: 0 };
    }

    await step.run("fire-events", async () => {
      await inngest.send(
        fresh.map((r) => ({
          name: `report.onward.${r.destination}`,
          data: {
            log_id: r.log_id,
            scam_report_id: r.scam_report_id,
            destination_key: r.destination_key,
            analysis_id: null,
          },
        })),
      );
    });

    logger.info("onward-auto-report: enqueued", {
      candidates: candidates.length,
      enqueued: fresh.length,
      destinations: destinations.map((d) => d.destination),
    });

    return { ok: true, candidates: candidates.length, enqueued: fresh.length };
  },
);
