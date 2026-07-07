import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

/**
 * Phase B — Netcraft takedown-status polling.
 *
 * Pulls alerts whose Netcraft submission UUID is set but that haven't reached a
 * terminal lifecycle state, hits the Netcraft v3 status endpoint, and maps the
 * verdict onto the enforcement lifecycle (v199) via advance_clone_lifecycle:
 *   - `malicious` / `already blocked` → 'taken_down' (stamps takedown_at).
 *   - `no threats`                    → 'declined' (stamps netcraft_declined_at;
 *                                        NOT a takedown — handed to the re-check
 *                                        loop, re-submitted only on weaponisation).
 *   - `processing`/`suspicious`/`unavailable`/unknown → keep polling.
 *
 * Powers the median-time-to-takedown KPI on /admin/clone-watch + the weekly
 * digest + the LinkedIn draft — which is why a declined lookalike must NOT be
 * recorded as a takedown (the pre-v199 bug that inflated the KPI).
 *
 * Gated by FF_SHOPFRONT_CLONE_OUTREACH + FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT
 * + NETCRAFT_REPORT_API_KEY presence. Skip-with-reason when any is missing
 * so the cron runs cleanly even when the upstream submit fn hasn't been
 * activated yet.
 *
 * See docs/plans/clone-watch-outreach.md §15 Phase B.
 */

const NETCRAFT_STATUS_ENDPOINT = "https://report.netcraft.com/api/v3/submission";

// Netcraft Report API v3 state machine (verified against the v3 changelog).
// The real per-submission states are: `processing`, `no threats`,
// `unavailable`, `suspicious`, `malicious` — with the deprecated
// `phishing`/`malware`/`web shell`/`already blocked` folded into `malicious`.
// States are normalised (lowercased, spaces→underscores) before comparison.
//
// This split is the fix for the founder-reported bug: a `no threats` verdict is
// Netcraft DECLINING to act (it grades on live content; our NRD hits are parked
// / cloaked / pre-weaponisation at scan time) — it is NOT a takedown. Recording
// it as terminal (the old behaviour) both dropped the domain from all future
// re-checks AND miscounted it as a takedown, inflating the time-to-takedown KPI.
//
// ACTIONED → lifecycle 'taken_down' (stamp takedown_at). This is the ONLY path
//            that records a takedown.
// DECLINED → lifecycle 'declined' (stamp netcraft_declined_at). Re-check
//            eligible; re-submitted only on a fresh weaponisation transition.
// everything else (processing/suspicious/unavailable/unknown) → keep polling.
const NETCRAFT_ACTIONED = new Set(["malicious", "already_blocked"]);
const NETCRAFT_DECLINED = new Set(["no_threats"]);

/** Lowercase + collapse whitespace to underscores so "no threats" → "no_threats". */
function normaliseNetcraftState(state: string): string {
  return state.toLowerCase().trim().replace(/\s+/g, "_");
}

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
  // No cron trigger: Netcraft submission is dark in prod
  // (FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT + NETCRAFT_REPORT_API_KEY both unset),
  // so an hourly poll only burned ~720 Inngest executions/mo to early-return.
  // The manual-trigger event is retained so polling resumes the moment
  // submission is enabled — re-add `{ cron: "0 * * * *" }` here at that point.
  [{ event: "shopfront/clone.poll-netcraft.manual-trigger.v1" }],
  withAxiomLogging({ fnId: "shopfront-clone-poll-netcraft" }, async ({ step }) => {
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
    let declined = 0;
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
      else if (outcome.kind === "declined") declined++;
      else still_pending++;

      await step.run(`persist-${row.id}`, async () => {
        const nowIso = new Date().toISOString();
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
          // outcome.state is already normalised (lowercase, underscores) so
          // re-poll lookups + set membership compare consistently.
          state: outcome.state,
          last_checked_at: nowIso,
        };
        // ACTIONED — the ONLY path that records a takedown. Idempotent on
        // takedown_at so a re-poll doesn't reset the first-seen time.
        if (outcome.kind === "takedown" && !existingNetcraft.takedown_at) {
          fragment.takedown_at = nowIso;
          fragment.takedown_state_observed = outcome.state;
        }
        // DECLINED — Netcraft "no threats". Record it distinctly; do NOT stamp
        // takedown_at. The lifecycle transition below keeps it re-check eligible.
        if (outcome.kind === "declined") {
          fragment.declined_at = nowIso;
          fragment.declined_state_observed = outcome.state;
        }
        // This step does TWO writes (the netcraft fragment + the lifecycle
        // transition). supabase-js does NOT throw on a Postgres error, so we
        // must inspect each result and throw — otherwise a half-applied write
        // (e.g. takedown_at stamped but lifecycle_state not advanced) would be
        // silently committed and, because the poll worklist filters
        // `takedown_at IS NULL`, the row would be excluded from re-polling and
        // never self-heal. Both RPCs are idempotent, so throwing lets Inngest
        // retry the whole step to a consistent state.
        const { error: mergeErr } = await sb.rpc("merge_clone_alert_submission", {
          p_alert_id: row.id,
          p_key: "netcraft",
          p_value: fragment,
          p_set_triage_status: null,
        });
        if (mergeErr) {
          throw new Error(
            `merge_clone_alert_submission failed for alert ${row.id}: ${mergeErr.message}`,
          );
        }

        // Drive the enforcement lifecycle through the single guarded RPC.
        // A `pending` verdict leaves the alert at 'reported' (keep polling).
        const nextState =
          outcome.kind === "takedown"
            ? "taken_down"
            : outcome.kind === "declined"
              ? "declined"
              : null;
        if (nextState) {
          const { error: advanceErr } = await sb.rpc("advance_clone_lifecycle", {
            p_alert_id: row.id,
            p_to_state: nextState,
          });
          if (advanceErr) {
            throw new Error(
              `advance_clone_lifecycle(${nextState}) failed for alert ${row.id}: ${advanceErr.message}`,
            );
          }
        }
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
          declined,
          still_pending,
          errors,
        },
      });
    });

    logger.info("clone-watch netcraft poll: complete", {
      polled: pending.length,
      takedowns,
      declined,
      still_pending,
      errors,
    });

    return {
      ok: true,
      polled: pending.length,
      takedowns_recorded: takedowns,
      declined,
      still_pending,
      errors,
    };
  }),
);

type PollOutcome =
  | { kind: "takedown"; state: string } // Netcraft actioned it (malicious/blocked)
  | { kind: "declined"; state: string } // Netcraft "no threats" — NOT terminal
  | { kind: "pending"; state: string } // processing/suspicious/unavailable
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
    const rawState =
      (typeof json.state === "string" && json.state) ||
      (typeof json.status === "string" && json.status) ||
      "unknown";
    const state = normaliseNetcraftState(rawState);
    const kind: PollOutcome["kind"] = NETCRAFT_ACTIONED.has(state)
      ? "takedown"
      : NETCRAFT_DECLINED.has(state)
        ? "declined"
        : "pending";
    // M2 observability — log raw + normalised state on every poll so we can
    // spot Netcraft state-machine drift (a new label we don't recognise falls
    // through to "pending" and keeps being polled rather than mis-terminalised).
    logger.info("clone-watch netcraft poll: observed state", {
      alertId: row.id,
      rawState,
      state,
      kind,
    });
    return { kind, state } as PollOutcome;
  } catch (err) {
    logger.warn("clone-watch netcraft poll: fetch failed", {
      alertId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "error", state: "fetch_failed" };
  }
}

// Export for testing.
export { NETCRAFT_ACTIONED, NETCRAFT_DECLINED, normaliseNetcraftState, pollOne };
export type { PendingPollRow, PollOutcome };
