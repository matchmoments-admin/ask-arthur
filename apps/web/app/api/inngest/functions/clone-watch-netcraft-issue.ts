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
import { probeLiveness } from "@/lib/clone-watch/liveness";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import {
  buildIssuePayload,
  postNetcraftIssue,
} from "@/lib/clone-watch/netcraft-issue-report";
import {
  fetchNetcraftSubmissionUrls,
  NETCRAFT_URL_STATE,
  selectFalseNegativeCandidates,
  type PendingAlert,
} from "@/lib/clone-watch/netcraft-urls";

/**
 * Clone-Watch — Netcraft false-negative auto-escalation (PR2-hardened).
 *
 * Reads the PER-URL truth from GET /submission/{uuid}/urls (keyless) and files a
 * "report an issue" (POST /submission/{uuid}/report_issue, keyless) on branded
 * lookalikes Netcraft graded `no threats` inside an otherwise-"malicious" bulk
 * batch — the false negatives that are invisible on the result email + on any
 * submission-level read.
 *
 * PR2 hardening (ultracode wf_300bd165-f03 + live smoke):
 *  - uuid-ATOMIC worklist (RPC groups by submission uuid) → a batch can't be
 *    split across runs and double-filed.
 *  - ARCHIVAL FIRST: is_archived (from a 200 body OR a 404) short-circuits
 *    before any candidate build — a POST to an archived submission 404s forever.
 *  - has_issues GATE: never file a 2nd issue on a submission that already has one.
 *  - DEAD-LETTER: a non-2xx splits transient (0/429/5xx → bump attempts, drop at
 *    3) from permanent (other 4xx → terminal skip) so a rejected uuid drains
 *    instead of re-POSTing daily forever.
 *  - AUTOBRAKE: a per-run 4xx-reject spike UPSERTs feature_brakes + pages admin.
 *  - DRAIN: every matched-but-not-filed alert is stamped terminal / recheck so
 *    the worklist converges (absence of the stamp is never the "retry" signal).
 *  - state_counts PRE-FILTER skips the /urls GET when a batch has no escalatable
 *    state.
 *
 * SAFETY: gated FF_CLONE_NETCRAFT_ISSUE (+ parent FF_SHOPFRONT_CLONE_OUTREACH) +
 * feature_brakes.clone_netcraft_issue. DRY-RUN by default (NETCRAFT_ISSUE_DRY_RUN
 * must be literally "false" to go live; dry-run does ZERO posts + ZERO writes).
 * Dedicated daily cap NETCRAFT_ISSUE_DAILY_CAP (default 20 uuids). `no threats`
 * only at go-live (unavailable → PR3). singleton + concurrency:1.
 *
 * F4 EVIDENCE GATE (v221): the worklist RPC only returns alerts with
 * urlscan_classification='likely_phishing' OR lifecycle_state='weaponised' —
 * escalating parked/neutral clones was crying wolf (the reconciler cross-tab
 * showed parked → 0% actioned) and burned reporter standing. Gated-out alerts
 * stay pending-by-predicate and re-enter the moment they weaponise; the
 * predicate re-asserts the gate in TS (deploy-skew fails closed) and the
 * issue reason cites our urlscan result URL as evidence.
 *
 * See docs/plans/clone-watch-netcraft-issue-pr2-fixes.md +
 * docs/plans/clone-watch-brand-value-features.md §F4.
 */

const BRAKE = "clone_netcraft_issue";
const DEFAULT_DAILY_CAP = 20;
const MAX_AGE_DAYS = 30;
// Autobrake: trip on this many permanent 4xx rejects in a run, OR >50% of live
// POSTs rejected. Transient (5xx/429/timeout) never trips it (Netcraft outage,
// not our fault).
const AUTOBRAKE_REJECT_COUNT = 3;
const AUTOBRAKE_REJECT_RATIO = 0.5;

function dailyCap(): number {
  const raw = Number.parseInt(process.env.NETCRAFT_ISSUE_DAILY_CAP ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_CAP;
}

function isDryRun(): boolean {
  return readStringEnv("NETCRAFT_ISSUE_DRY_RUN") !== "false";
}

/** Transient = worth retrying (bump attempts). Everything else 4xx is permanent. */
function isTransientStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

interface WorklistGroup {
  netcraft_uuid: string;
  alerts: PendingAlert[];
}

export const cloneWatchNetcraftIssue = inngest.createFunction(
  {
    id: "shopfront-clone-netcraft-issue",
    name: "Clone-Watch: Netcraft false-negative issue reporter",
    retries: 2,
    singleton: { mode: "skip" },
    concurrency: { limit: 1 },
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
      // Escalatable states drive both the /urls pre-filter and the predicate.
      const escalatableStates = dryRun
        ? [NETCRAFT_URL_STATE.NO_THREATS, NETCRAFT_URL_STATE.UNAVAILABLE]
        : [NETCRAFT_URL_STATE.NO_THREATS];

      const plan = await step.run("load-pending", async () => {
        const { data: usedRaw } = await sb.rpc("count_todays_netcraft_issues");
        const used = typeof usedRaw === "number" ? usedRaw : 0;
        const remaining = Math.max(0, cap - used);
        if (remaining <= 0) return { used, remaining, groups: [] as WorklistGroup[] };

        const { data: rows } = await sb.rpc(
          "list_clone_alerts_pending_netcraft_issue",
          { p_max_age_days: MAX_AGE_DAYS, p_uuid_limit: remaining },
        );
        const groups: WorklistGroup[] = (
          (rows as Array<{ netcraft_uuid: string; alerts: unknown }> | null) ?? []
        )
          .map((r) => ({
            netcraft_uuid: r.netcraft_uuid,
            alerts: (Array.isArray(r.alerts) ? (r.alerts as PendingAlert[]) : [])
              // Extra FP guard beyond the RPC's domain list (v176 brand denylist).
              .filter((a) => !isFpBrand(a.inferred_target_domain ?? "")),
          }))
          .filter((g) => g.alerts.length > 0);
        return { used, remaining, groups };
      });

      if (plan.groups.length === 0) {
        return {
          ok: true,
          dryRun,
          reason: plan.remaining === 0 ? "daily_cap_reached" : "nothing_pending",
          filed: 0,
        };
      }

      const counts = {
        filed: 0,
        dryRunLogged: 0,
        archived: 0,
        noEscalatable: 0,
        hasIssues: 0,
        transientErrors: 0,
        permanentRejects: 0,
        drained: 0,
        livePosts: 0,
        deadDeferred: 0,
      };

      const bulkStamp = async (ids: number[], value: Record<string, unknown>) => {
        if (ids.length === 0) return;
        const { error } = await sb.rpc("merge_clone_alert_submission_bulk", {
          p_alert_ids: ids,
          p_key: "netcraft_issue",
          p_value: value,
        });
        if (error) {
          throw new Error(
            `merge_clone_alert_submission_bulk failed (${ids.length} alerts): ${error.message}`,
          );
        }
      };

      for (const group of plan.groups) {
        const uuid = group.netcraft_uuid;
        const allIds = group.alerts.map((a) => a.id);

        const fetched = await step.run(`fetch-${uuid}`, () =>
          fetchNetcraftSubmissionUrls(uuid, { escalatableStates }),
        );

        // BLOCK-2 — archival is authoritative + checked FIRST (a 200 body with
        // is_archived=1 must not build candidates → the POST would 404 forever).
        if (fetched.isArchived) {
          counts.archived++;
          if (!dryRun) {
            await step.run(`drain-archived-${uuid}`, () =>
              bulkStamp(allIds, { skipped: "archived", at: new Date().toISOString() }),
            );
          }
          continue;
        }
        if (!fetched.ok) {
          counts.transientErrors++;
          logger.warn("netcraft-issue: submission/urls fetch non-200", {
            uuid,
            status: fetched.status,
          });
          continue; // transient — retried next run (no stamp)
        }

        // state_counts pre-filter said the batch has no escalatable state.
        if (fetched.noEscalatable) {
          counts.noEscalatable++;
          if (!dryRun) {
            await step.run(`drain-noesc-${uuid}`, () =>
              bulkStamp(allIds, {
                skipped: "no_escalatable_state",
                at: new Date().toISOString(),
              }),
            );
          }
          continue;
        }

        const sel = selectFalseNegativeCandidates(group.alerts, fetched.urls, {
          allowUnavailable: dryRun,
        });

        // F4 (v221): the TS gate mirror blocked would-be candidates — only
        // possible under RPC/TS deploy skew. Unstamped → retried next run.
        if (sel.gatedOut.length) {
          logger.warn("netcraft-issue: evidence gate blocked candidates (RPC/TS skew?)", {
            uuid,
            gatedOut: sel.gatedOut.map((a) => a.id),
          });
        }

        if (sel.driftStates.length) {
          logger.warn("netcraft-issue: unknown url_state(s)", {
            uuid,
            driftStates: sel.driftStates,
          });
          if (!dryRun) {
            logEnforcementEvent("rejected", {
              alertId: group.alerts[0].id,
              domain: group.alerts[0].candidate_domain,
              channel: "netcraft",
              runId,
              extra: { reason: "url_state_drift", uuid, driftStates: sel.driftStates },
            });
          }
        }

        // F3 liveness pre-check: a $0 GET per candidate so we never spend the
        // submission's SINGLE issue slot on a site that is already down
        // (Netcraft would just grade it "unavailable"). Dead sites revive —
        // dead candidates get a non-terminal recheck_after, never a slot.
        // Probe ONLY when the result can matter: live mode (dry-run's widened
        // unavailable states are the DNS-dead worst case — 8s timeouts that
        // can blow the 5m finish budget at cap 20) and a filable uuid
        // (has_issues → the slot is already spent; don't GET attacker infra
        // for a decision that's a dead end either way).
        const shouldProbe =
          !dryRun && !fetched.hasIssues && sel.candidates.length > 0;
        const liveness = await step.run(`liveness-${uuid}`, async () => {
          if (!shouldProbe) return {} as Record<string, boolean>;
          const map = await probeLiveness(sel.candidates.map((c) => c.candidateUrl));
          return Object.fromEntries(map);
        });
        const liveCandidates = sel.candidates.filter(
          (c) => liveness[c.candidateUrl] === true,
        );
        const deadCandidates = sel.candidates.filter(
          (c) => liveness[c.candidateUrl] !== true,
        );

        // DRY-RUN: log the UNGATED candidate payload, write NOTHING. Dry-run
        // never probes liveness (shouldProbe), so its urlCount/payload can
        // OVERSTATE what a live run would file — a live run drops the
        // dead-at-probe subset. Size go-live volume accordingly.
        if (dryRun) {
          if (sel.candidates.length) {
            await step.run(`dryrun-log-${uuid}`, () => {
              logEnforcementEvent("issue_reported", {
                alertId: sel.candidates[0].alertId,
                domain: sel.candidates[0].candidateDomain,
                channel: "netcraft",
                runId,
                extra: {
                  dryRun: true,
                  uuid,
                  urlCount: sel.candidates.length,
                  brands: [...new Set(sel.candidates.map((c) => c.brand))],
                  states: [...new Set(sel.candidates.map((c) => c.urlState))],
                  gate: [...new Set(sel.candidates.map((c) => c.evidence))],
                  hasIssues: fetched.hasIssues,
                  // Dry-run doesn't probe (see shouldProbe) — the payload is
                  // the ungated candidate set, as before F3.
                  payload: buildIssuePayload(sel.candidates),
                },
              });
            });
            counts.dryRunLogged++;
          }
          continue;
        }

        // LIVE. has_issues → do not file a 2nd issue; drain candidates too.
        // Liveness: only file when at least one candidate is actually up.
        const willPost = !fetched.hasIssues && liveCandidates.length > 0;

        // All candidates dead at probe → don't spend the slot. Non-terminal
        // recheck_after (+72h): a revived site re-enters; permanent deadness
        // converges via the worklist's 30-day submitted_at window.
        if (shouldProbe && liveCandidates.length === 0) {
          await step.run(`defer-dead-${uuid}`, async () => {
            const recheck = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
            await bulkStamp(
              sel.candidates.map((c) => c.alertId),
              { recheck_after: recheck, at: new Date().toISOString() },
            );
            logEnforcementEvent("rejected", {
              alertId: sel.candidates[0].alertId,
              domain: sel.candidates[0].candidateDomain,
              channel: "netcraft",
              runId,
              extra: {
                reason: "dead_at_probe",
                uuid,
                deadDomains: deadCandidates.map((c) => c.candidateDomain),
              },
            });
          });
          counts.deadDeferred++;
        }

        await step.run(`drain-${uuid}`, async () => {
          const now = new Date().toISOString();
          for (const reason of [
            "actioned",
            "unavailable_deferred",
            "no_escalatable_state",
          ] as const) {
            const ids = sel.terminal
              .filter((t) => t.reason === reason)
              .map((t) => t.alert.id);
            await bulkStamp(ids, { skipped: reason, at: now });
          }
          if (sel.transient.length) {
            const recheck = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            await bulkStamp(
              sel.transient.map((a) => a.id),
              { recheck_after: recheck, at: now },
            );
          }
          // FIX-8: only drain not-in-urls when the page is COMPLETE (else an
          // incomplete ingest / paginated tail would lose a real false negative).
          if (sel.notInUrls.length && fetched.totalCount <= fetched.urls.length) {
            await bulkStamp(
              sel.notInUrls.map((a) => a.id),
              { skipped: "not_in_urls", at: now },
            );
          }
          // has_issues: candidates can't be filed — drain them.
          if (!willPost && fetched.hasIssues && sel.candidates.length) {
            await bulkStamp(
              sel.candidates.map((c) => c.alertId),
              { skipped: "submission_has_issue", at: now },
            );
          }
        });
        counts.drained++;

        if (!willPost) {
          if (fetched.hasIssues) counts.hasIssues++;
          continue;
        }

        const candidateIds = liveCandidates.map((c) => c.alertId);
        const result = await step.run(`post-${uuid}`, () =>
          postNetcraftIssue(uuid, buildIssuePayload(liveCandidates)),
        );
        counts.livePosts++;

        if (!result.ok) {
          if (isTransientStatus(result.status)) {
            counts.transientErrors++;
            await step.run(`bump-${uuid}`, async () => {
              for (const id of candidateIds) {
                await sb.rpc("bump_clone_alert_netcraft_issue_attempt", {
                  p_alert_id: id,
                  p_status: result.status,
                  p_error: result.body,
                });
              }
            });
            logEnforcementEvent("rejected", {
              alertId: candidateIds[0],
              domain: liveCandidates[0].candidateDomain,
              channel: "netcraft",
              runId,
              extra: { reason: "transient", uuid, status: result.status },
            });
          } else {
            counts.permanentRejects++;
            await step.run(`stamp-4xx-${uuid}`, () =>
              bulkStamp(candidateIds, {
                skipped: "post_4xx",
                status: result.status,
                at: new Date().toISOString(),
              }),
            );
            logEnforcementEvent("rejected", {
              alertId: candidateIds[0],
              domain: liveCandidates[0].candidateDomain,
              channel: "netcraft",
              runId,
              extra: { reason: "post_4xx", uuid, status: result.status, body: result.body },
            });
          }
          continue;
        }

        // Success — POST memoised in its own step; stamp in a SEPARATE step.
        await step.run(`stamp-${uuid}`, async () => {
          await bulkStamp(candidateIds, {
            issue_reported_at: new Date().toISOString(),
            issue_url_state: NETCRAFT_URL_STATE.NO_THREATS,
            via: "auto",
          });
          // The successful POST consumed this uuid's single issue slot, so
          // the dead-at-probe candidates can never be filed here — stamp them
          // legibly NOW (never before: a failed POST leaves them pending so a
          // revived site can still be filed on a later run).
          if (deadCandidates.length) {
            await bulkStamp(
              deadCandidates.map((c) => c.alertId),
              { skipped: "dead_at_probe", at: new Date().toISOString() },
            );
          }
          logEnforcementEvent("issue_reported", {
            alertId: candidateIds[0],
            domain: liveCandidates[0].candidateDomain,
            channel: "netcraft",
            runId,
            extra: {
              dryRun: false,
              uuid,
              urlCount: candidateIds.length,
              deadDeferred: deadCandidates.length,
              brands: [...new Set(liveCandidates.map((c) => c.brand))],
              status: result.status,
            },
          });
        });
        counts.filed++;
      }

      // BLOCK-5 — autobrake on a permanent-reject spike (standing safety net).
      const tripBrake =
        !dryRun &&
        (counts.permanentRejects >= AUTOBRAKE_REJECT_COUNT ||
          (counts.livePosts > 0 &&
            counts.permanentRejects / counts.livePosts > AUTOBRAKE_REJECT_RATIO));
      if (tripBrake) {
        await step.run("autobrake", async () => {
          // UPSERT (not update): the row doesn't exist by default, and
          // isFeatureBraked treats a missing row as open.
          await sb.from("feature_brakes").upsert(
            {
              feature: BRAKE,
              paused_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
              reason: `auto: ${counts.permanentRejects}/${counts.livePosts} report_issue 4xx rejects`,
              set_by: "netcraft-issue-autobrake",
            },
            { onConflict: "feature" },
          );
          await sendAdminTelegramMessage(
            [
              "🛑 <b>Clone-watch — Netcraft issue reporter auto-braked</b>",
              `Permanent 4xx rejects: <b>${counts.permanentRejects}/${counts.livePosts}</b> this run.`,
              `<code>feature_brakes.${BRAKE}</code> engaged 24h. Likely a body-contract or standing problem — check before clearing.`,
            ].join("\n"),
          );
        });
      }

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_netcraft_issue",
          provider: "netcraft",
          operation: "issue_report",
          units: dryRun ? counts.dryRunLogged : counts.filed,
          unitCostUsd: 0,
          metadata: { dryRun, uuids: plan.groups.length, ...counts, braked: tripBrake },
        });
      });

      logger.info("netcraft-issue: complete", {
        dryRun,
        uuids: plan.groups.length,
        ...counts,
        braked: tripBrake,
      });

      return { ok: true, dryRun, uuids: plan.groups.length, ...counts, braked: tripBrake };
    },
  ),
);
