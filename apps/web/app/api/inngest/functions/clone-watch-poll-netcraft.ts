import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

/**
 * Phase B — Netcraft takedown-status polling.
 *
 * Runs every 30 min. Pulls up to 50 alerts whose Netcraft submission UUID
 * is set but `takedown_at` isn't. For each, hits Netcraft v3 status
 * endpoint and updates `submitted_to.netcraft.{state, last_checked_at,
 * takedown_at}` when the state transitions to a terminal "blocked /
 * processed" value.
 *
 * Powers the median-time-to-takedown KPI on /admin/clone-watch + the
 * weekly digest + the LinkedIn draft.
 *
 * Gated by FF_SHOPFRONT_CLONE_OUTREACH + FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT
 * + NETCRAFT_REPORT_API_KEY presence. Skip-with-reason when any is missing
 * so the cron runs cleanly even when the upstream submit fn hasn't been
 * activated yet.
 *
 * See docs/plans/clone-watch-outreach.md §15 Phase B.
 */

const NETCRAFT_STATUS_ENDPOINT = "https://report.netcraft.com/api/v3/submission";

// Netcraft v3 state machine — the exact terminal values aren't reproduced
// in their public docs, so we treat any state matching this allowlist as
// "completed enough to record takedown_at". On first prod observation,
// extend this set if Netcraft uses a different label. Untrusted state
// values are passed through unchanged into submitted_to so we have raw
// evidence to debug.
const TERMINAL_STATES = new Set([
  "processed",
  "complete",
  "closed",
  "taken_down",
  "no_action_required", // Netcraft determined the URL was safe — terminal regardless
  "not_phishing", // alternative label seen in some Netcraft responses
]);

// Batch size is bounded by the 5-min Inngest soft-target and the 10-min
// pg-stuck-query-watchdog hard cap. 25 rows × 12s per-fetch timeout = 5
// min worst case — safely under the watchdog edge. Originally 50, halved
// after ultrareview H1.
const POLL_BATCH_LIMIT = 25;
const PER_REQUEST_TIMEOUT_MS = 12_000;
// If more than this share of fetches in a single run fail, page admin —
// likely Netcraft outage or API-key drift. Closes ultrareview M4.
const OUTAGE_PAGE_ERROR_RATIO = 0.5;

interface PendingPollRow {
  id: number;
  netcraft_uuid: string;
  candidate_url: string;
  submitted_at: string;
}

export const cloneWatchPollNetcraft = inngest.createFunction(
  {
    id: "shopfront-clone-poll-netcraft",
    name: "Clone-Watch: Poll Netcraft takedown status",
    retries: 2,
    concurrency: { limit: 1 },
    // Hard cap below the 10-min pg-stuck-query-watchdog edge. Worst case is
    // POLL_BATCH_LIMIT (25) × PER_REQUEST_TIMEOUT_MS (12s) ≈ 5 min of fetches;
    // 8m leaves headroom for step overhead and defends against a future
    // POLL_BATCH_LIMIT bump that forgets to re-check the budget.
    timeouts: { finish: "8m" },
  },
  [
    { cron: "0 * * * *" },
    { event: "shopfront/clone.poll-netcraft.manual-trigger.v1" },
  ],
  async ({ step }) => {
    if (!featureFlags.shopfrontCloneOutreach) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_OUTREACH disabled" };
    }
    if (!featureFlags.shopfrontCloneSubmitNetcraft) {
      return {
        skipped: true,
        reason: "FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT disabled",
      };
    }
    const apiKey = process.env.NETCRAFT_REPORT_API_KEY;
    if (!apiKey) {
      return { skipped: true, reason: "NETCRAFT_REPORT_API_KEY not set" };
    }

    const sb = createServiceClient();
    if (!sb) {
      return { skipped: true, reason: "supabase_unavailable" };
    }

    const pending = await step.run("load-pending", async () => {
      const { data } = await sb.rpc("list_clone_alerts_pending_netcraft_poll", {
        p_limit: POLL_BATCH_LIMIT,
      });
      return (data as PendingPollRow[] | null) ?? [];
    });

    if (pending.length === 0) {
      return { ok: true, polled: 0, takedowns_recorded: 0 };
    }

    let takedowns = 0;
    let still_pending = 0;
    let errors = 0;

    for (const row of pending) {
      const outcome = await step.run(
        `poll-netcraft-${row.id}`,
        async () => pollOne(apiKey, row),
      );
      if (outcome.kind === "error") {
        errors++;
        continue;
      }
      if (outcome.kind === "takedown") takedowns++;
      else still_pending++;

      await step.run(`persist-${row.id}`, async () => {
        // Load existing netcraft fragment to preserve `submitted_at` + first
        // takedown_at. Atomic-merge writes the new fragment as ONE key
        // (avoids the cross-fn race that submit-netcraft + notify-brand
        // had pre-v147).
        const { data: alertRow } = await sb
          .from("shopfront_clone_alerts")
          .select("submitted_to")
          .eq("id", row.id)
          .maybeSingle();
        const existing =
          (alertRow?.submitted_to as Record<string, unknown> | null) ?? {};
        const existingNetcraft =
          (existing.netcraft as Record<string, unknown>) ?? {};
        const fragment: Record<string, unknown> = {
          ...existingNetcraft,
          // Stored lowercased so re-poll lookups + TERMINAL_STATES.has(...)
          // compare consistently. Closes ultrareview H5.
          state: outcome.state.toLowerCase(),
          last_checked_at: new Date().toISOString(),
        };
        if (outcome.kind === "takedown" && !existingNetcraft.takedown_at) {
          fragment.takedown_at = new Date().toISOString();
          fragment.takedown_state_observed = outcome.state;
        }
        await sb.rpc("merge_clone_alert_submission", {
          p_alert_id: row.id,
          p_key: "netcraft",
          p_value: fragment,
          p_set_triage_status: null,
        });
      });
    }

    // Outage-paging — if a large share of fetches failed, page admin so
    // they can check Netcraft status / API-key drift. Closes M4.
    if (
      pending.length >= 5 &&
      errors / pending.length >= OUTAGE_PAGE_ERROR_RATIO
    ) {
      await step.run("page-on-outage", async () => {
        await sendAdminTelegramMessage(
          [
            `⚠️ <b>Clone-watch — Netcraft poll degraded</b>`,
            `Errors: <b>${errors}/${pending.length}</b> (${Math.round(
              (errors / pending.length) * 100,
            )}%)`,
            `Possible cause: Netcraft outage, API-key rotation, or rate-limit.`,
            `Inngest dashboard: shopfront-clone-poll-netcraft`,
          ].join("\n"),
        );
      });
    }

    await step.run("log-cost", async () => {
      logCost({
        feature: "shopfront_clone_poll_netcraft",
        provider: "netcraft",
        operation: "status_poll",
        units: pending.length,
        unitCostUsd: 0,
        metadata: {
          polled: pending.length,
          takedowns_recorded: takedowns,
          still_pending,
          errors,
        },
      });
    });

    logger.info("clone-watch netcraft poll: complete", {
      polled: pending.length,
      takedowns,
      still_pending,
      errors,
    });

    return {
      ok: true,
      polled: pending.length,
      takedowns_recorded: takedowns,
      still_pending,
      errors,
    };
  },
);

type PollOutcome =
  | { kind: "takedown"; state: string }
  | { kind: "pending"; state: string }
  | { kind: "error"; state: string };

async function pollOne(
  apiKey: string,
  row: PendingPollRow,
): Promise<PollOutcome> {
  try {
    const res = await fetch(
      `${NETCRAFT_STATUS_ENDPOINT}/${encodeURIComponent(row.netcraft_uuid)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      logger.warn("clone-watch netcraft poll: non-200", {
        alertId: row.id,
        status: res.status,
      });
      return { kind: "error", state: `http_${res.status}` };
    }
    const json = (await res.json()) as Record<string, unknown>;
    const state =
      (typeof json.state === "string" && json.state) ||
      (typeof json.status === "string" && json.status) ||
      "unknown";
    // M2 observability — log raw state on every poll so we can spot
    // Netcraft state-machine drift (e.g. they add a new terminal label
    // we don't recognise). Cheap log line; no PII.
    logger.info("clone-watch netcraft poll: observed state", {
      alertId: row.id,
      state,
      isTerminal: TERMINAL_STATES.has(state.toLowerCase()),
    });
    return TERMINAL_STATES.has(state.toLowerCase())
      ? { kind: "takedown", state }
      : { kind: "pending", state };
  } catch (err) {
    logger.warn("clone-watch netcraft poll: fetch failed", {
      alertId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "error", state: "fetch_failed" };
  }
}

// Export for testing.
export { TERMINAL_STATES, pollOne };
export type { PendingPollRow, PollOutcome };
