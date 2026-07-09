import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";
import {
  buildIssuePayload,
  postNetcraftIssue,
} from "@/lib/clone-watch/netcraft-issue-report";
import {
  fetchNetcraftSubmissionUrls,
  selectFalseNegativeCandidates,
  type PendingAlert,
} from "@/lib/clone-watch/netcraft-urls";

/**
 * Clone-Watch — Netcraft false-negative auto-escalation.
 *
 * Netcraft grades on LIVE content, so branded lookalikes that are parked /
 * cloaked / pre-weaponisation at scan time come back non-malicious. And because
 * our bulk submitter sends ≤50 URLs under ONE submission uuid, the
 * submission-level `state` is a rollup that reads "malicious" if ANY url is
 * malicious — so the branded lookalikes that individually came back
 * `no threats` / `unavailable` are invisible on the email + on any
 * submission-level read. This fn reads the PER-URL truth from
 * GET /submission/{uuid}/urls (keyless) and files a "report an issue"
 * (POST /submission/{uuid}/report_issue, keyless) on the branded false negatives
 * to force Netcraft to re-review.
 *
 * SAFETY (reporter standing is a shared, finite resource):
 *  - Gated FF_CLONE_NETCRAFT_ISSUE (+ the parent FF_SHOPFRONT_CLONE_OUTREACH)
 *    and the feature_brakes.clone_netcraft_issue kill-switch.
 *  - DRY-RUN by default: NETCRAFT_ISSUE_DRY_RUN must be the literal "false" to go
 *    live (read via !== "false" so an unset/whitespace value stays dry-run — a
 *    readBoolEnv default would go LIVE on first deploy). In dry-run the fn does
 *    ZERO POSTs and ZERO DB writes — it only fetches + logs the payload it WOULD
 *    send, so the founder can eyeball real false negatives first.
 *  - Bounded by a dedicated daily cap (NETCRAFT_ISSUE_DAILY_CAP, default 20
 *    submission-uuids/day) — distinct from the takedown-submission cap.
 *  - `no threats` only at go-live (unavailable → PR3, screenshot-backed): a URL
 *    Netcraft couldn't fetch can't be re-verified on re-look, so filing on it
 *    with no corroborating evidence would erode standing. Dry-run observes both.
 *  - singleton skip + concurrency 1 close the overlapping-run double-file race;
 *    POST and the idempotency stamp are SEPARATE Inngest steps (a stamp failure
 *    re-runs the stamp, never the POST). The per-alert `netcraft_issue` stamp is
 *    the primary idempotency guard.
 *
 * See docs/plans/clone-watch-netcraft-false-negative-escalation.md.
 */

const BRAKE = "clone_netcraft_issue";
const DEFAULT_DAILY_CAP = 20;
// Include `unavailable` only in dry-run observation; live go-live (PR1/PR2)
// files on `no threats` only. Flip to true (or make it a flag) in PR3 once
// url_misclassifications carry a fetchable urlscan screenshot.
const ALLOW_UNAVAILABLE_LIVE = false;

function dailyCap(): number {
  const raw = Number.parseInt(process.env.NETCRAFT_ISSUE_DAILY_CAP ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_CAP;
}

function isDryRun(): boolean {
  // Dry-run unless explicitly disabled. Do NOT route through readBoolEnv:
  // its strict === "true" would make an unset value falsy → LIVE by default.
  return readStringEnv("NETCRAFT_ISSUE_DRY_RUN") !== "false";
}

export const cloneWatchNetcraftIssue = inngest.createFunction(
  {
    id: "shopfront-clone-netcraft-issue",
    name: "Clone-Watch: Netcraft false-negative issue reporter",
    retries: 2,
    // Overlapping runs (cron + manual, or a slow run + the next cron) would both
    // load the same unstamped alerts and both POST → double file. singleton +
    // concurrency:1 make that structurally impossible.
    singleton: { mode: "skip" },
    concurrency: { limit: 1 },
    // Grouped-by-uuid means a day is a few GET+POST pairs; 5m is ample and stays
    // under the 10-min pg-stuck-query-watchdog edge.
    timeouts: { finish: "5m" },
  },
  [
    { cron: "0 11 * * *" },
    { event: "shopfront/clone.netcraft-issue.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-netcraft-issue" },
    async ({ step, runId }) => {
      if (!featureFlags.shopfrontCloneOutreach) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_OUTREACH disabled" };
      }
      if (!featureFlags.cloneNetcraftIssue) {
        return { skipped: true, reason: "FF_CLONE_NETCRAFT_ISSUE disabled" };
      }
      const braked = await step.run("check-brake", () => isFeatureBraked(BRAKE));
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const dryRun = isDryRun();
      const cap = dailyCap();

      // Load the worklist + today's cap usage, then group by submission uuid and
      // slice to the remaining budget (in submission-uuids).
      const plan = await step.run("load-pending", async () => {
        const { data: rows } = await sb.rpc(
          "list_clone_alerts_pending_netcraft_issue",
          { p_max_age_days: 14, p_limit: 500 },
        );
        const { data: usedRaw } = await sb.rpc("count_todays_netcraft_issues");
        const used = typeof usedRaw === "number" ? usedRaw : 0;
        const remaining = Math.max(0, cap - used);

        const groups = new Map<string, PendingAlert[]>();
        for (const r of (rows as PendingAlert[] | null) ?? []) {
          // Extra FP guard beyond the RPC's domain list (v176 brand denylist).
          if (isFpBrand(r.inferred_target_domain ?? "")) continue;
          const list = groups.get(r.netcraft_uuid) ?? [];
          list.push(r);
          groups.set(r.netcraft_uuid, list);
        }
        // Serialise Map → array for the Inngest step boundary; slice uuids to budget.
        return {
          used,
          remaining,
          groups: [...groups.entries()].slice(0, remaining),
        };
      });

      if (plan.groups.length === 0) {
        return {
          ok: true,
          dryRun,
          reason: plan.remaining === 0 ? "daily_cap_reached" : "nothing_pending",
          filed: 0,
        };
      }

      let filed = 0;
      let dryRunLogged = 0;
      let archived = 0;
      let notFound = 0;
      let errors = 0;

      for (const [uuid, alerts] of plan.groups) {
        const fetched = await step.run(`fetch-${uuid}`, () =>
          fetchNetcraftSubmissionUrls(uuid),
        );

        if (!fetched.ok) {
          if (fetched.isArchived) {
            // Permanent: the /report_issue endpoint 404s on archived submissions.
            archived++;
            if (!dryRun) {
              await step.run(`stamp-archived-${uuid}`, () =>
                stampAlerts(sb, alerts, { skipped: "archived" }),
              );
            }
            continue;
          }
          // Transient non-200 → soft diag, no stamp, retried next run.
          errors++;
          logger.warn("netcraft-issue: submission fetch non-200", {
            uuid,
            status: fetched.status,
          });
          continue;
        }

        const { candidates, notInUrls, driftStates } = selectFalseNegativeCandidates(
          alerts,
          fetched.urls,
          { allowUnavailable: dryRun ? true : ALLOW_UNAVAILABLE_LIVE },
        );
        if (driftStates.length) {
          logger.warn("netcraft-issue: unknown url_state(s) observed", {
            uuid,
            driftStates,
          });
        }

        if (candidates.length === 0) {
          // Drain alerts whose host never appeared in /urls (Netcraft dropped /
          // normalised them) so the worklist doesn't re-fetch them forever.
          if (!dryRun && notInUrls.length) {
            notFound += notInUrls.length;
            await step.run(`stamp-notfound-${uuid}`, () =>
              stampAlerts(sb, notInUrls, { skipped: "not_in_urls" }),
            );
          }
          continue;
        }

        const payload = buildIssuePayload(candidates);
        const summary = {
          uuid,
          alertIds: candidates.map((c) => c.alertId),
          brands: [...new Set(candidates.map((c) => c.brand))],
          urlCount: candidates.length,
          states: [...new Set(candidates.map((c) => c.urlState))],
          hasIssues: fetched.hasIssues,
        };

        if (dryRun) {
          await step.run(`dryrun-log-${uuid}`, () => {
            logEnforcementEvent("issue_reported", {
              alertId: candidates[0].alertId,
              domain: candidates[0].candidateDomain,
              channel: "netcraft",
              runId,
              extra: { ...summary, dryRun: true, payload },
            });
          });
          dryRunLogged++;
          continue;
        }

        // LIVE — POST in its own step (memoised on return; never throws), then
        // stamp in a SEPARATE step so a stamp failure re-runs only the stamp.
        const result = await step.run(`post-${uuid}`, () =>
          postNetcraftIssue(uuid, payload),
        );
        if (!result.ok) {
          errors++;
          logger.warn("netcraft-issue: report_issue non-2xx (retry next run)", {
            uuid,
            status: result.status,
            body: result.body,
          });
          continue; // no stamp → re-attempted next daily run
        }

        await step.run(`stamp-${uuid}`, async () => {
          const nowIso = new Date().toISOString();
          await stampAlerts(
            sb,
            candidates.map((c) => ({ id: c.alertId })),
            { issue_reported_at: nowIso, via: "auto" },
            (alertId) => ({
              issue_url_state:
                candidates.find((c) => c.alertId === alertId)?.urlState ?? null,
            }),
          );
          if (notInUrls.length) {
            await stampAlerts(sb, notInUrls, { skipped: "not_in_urls" });
          }
          logEnforcementEvent("issue_reported", {
            alertId: candidates[0].alertId,
            domain: candidates[0].candidateDomain,
            channel: "netcraft",
            runId,
            extra: { ...summary, dryRun: false, status: result.status },
          });
        });
        filed++;
      }

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_netcraft_issue",
          provider: "netcraft",
          operation: "issue_report",
          units: dryRun ? dryRunLogged : filed,
          unitCostUsd: 0, // keyless
          metadata: {
            dryRun,
            filed,
            dryRunLogged,
            archived,
            notFound,
            errors,
            uuids: plan.groups.length,
            capUsed: plan.used,
          },
        });
      });

      logger.info("netcraft-issue: complete", {
        dryRun,
        filed,
        dryRunLogged,
        archived,
        notFound,
        errors,
        uuids: plan.groups.length,
      });

      return {
        ok: true,
        dryRun,
        filed,
        dryRunLogged,
        archived,
        notFound,
        errors,
        uuids: plan.groups.length,
      };
    },
  ),
);

/**
 * Stamp the sibling `netcraft_issue` key on each alert via the atomic v147 RPC.
 * Writing under `netcraft_issue` (NOT `netcraft`) is deliberate:
 * merge_clone_alert_submission replaces the whole key, so writing to `netcraft`
 * would obliterate the uuid/state/via the poll + cap counter depend on.
 */
async function stampAlerts(
  sb: NonNullable<ReturnType<typeof createServiceClient>>,
  alerts: Array<{ id: number }>,
  base: Record<string, unknown>,
  perAlert?: (alertId: number) => Record<string, unknown>,
): Promise<void> {
  for (const a of alerts) {
    const { error } = await sb.rpc("merge_clone_alert_submission", {
      p_alert_id: a.id,
      p_key: "netcraft_issue",
      p_value: { ...base, ...(perAlert ? perAlert(a.id) : {}) },
      p_set_triage_status: null,
    });
    if (error) {
      throw new Error(
        `merge_clone_alert_submission(netcraft_issue) failed for alert ${a.id}: ${error.message}`,
      );
    }
  }
}
