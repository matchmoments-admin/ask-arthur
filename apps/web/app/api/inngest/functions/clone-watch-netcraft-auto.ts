import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";
import { probeLivenessDetailed } from "@/lib/clone-watch/liveness";

/**
 * Clone-Watch — Netcraft AUTO-report producer (PR3).
 *
 * Today a clone only reaches Netcraft when a human manually triages it (the
 * admin triage route emits CLONE_WATCH_TRIAGED_EVENT → the per-candidate
 * submit-netcraft worker). That leaves the high-confidence branded tail
 * unreported. This cron sweeps clones the Haiku preclassifier judged a likely
 * clone (is_clone AND confidence >= threshold) that target a real brand,
 * aren't FP-denylisted, and haven't been submitted.
 *
 * BULK submission (not per-candidate fan-out). The first cut fanned out one
 * `shopfront/clone.netcraft-auto.v1` event per candidate into the per-candidate
 * worker; with 100–160 candidates that made 100–160 separate Netcraft API calls
 * and tripped Netcraft's per-request rate limit (HTTP 429 — Axiom error burst
 * 2026-06-15 ~07:30 UTC). Netcraft's /api/v3/report/urls accepts an ARRAY of
 * urls in ONE call (the manual backfill submitted 107 at once with no 429), so
 * we submit the whole batch in a single keyless request and mark every alert
 * with the returned uuid. One request → no 429.
 *
 * A non-2xx from Netcraft is logged as a $0 diagnostic (surfaces in the daily
 * cost digest) and the batch is left unmarked for the next run — we do NOT
 * throw, so a transient Netcraft hiccup never raises an Inngest fn error / the
 * Axiom fleet alert.
 *
 * Daily cap (no flooding). The candidate RPC (v185) folds in a 24h budget:
 * it counts clones already auto-bulk-submitted in the last 24h and returns at
 * most (DAILY_CAP − that), hard-capped at 50, ordered best-confidence-first. So
 * a normal day is ONE bulk request of ≤50 URLs, and re-firing the manual
 * trigger cannot exceed the day's budget — structurally impossible to flood.
 *
 * Test mode. Fire the manual-trigger event with `{ test: true }` to validate
 * the exact payload against Netcraft's TEST endpoint (validates only — NO
 * report is created, NO confirmation emails). Nothing is persisted. This is the
 * sanctioned way to prove the path works without touching the live submit API.
 * It covers BOTH lanes: the resubmit lane used to return on `isTest` before its
 * own flag check, so a validation run exercised the proven auto-lane payload
 * and none of the novel one. Under test both lanes bypass their FF gates, and
 * the resubmit lane still builds its body from the real worklist — an all-dead
 * batch falls through to validation rather than short-circuiting.
 *
 * Triple-gated: FF_SHOPFRONT_CLONE_NETCRAFT_AUTO (this producer) +
 * FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT + FF_SHOPFRONT_CLONE_OUTREACH. Default OFF.
 * Cron 13:00 UTC + a manual-trigger event.
 *
 * EVIDENCE GATE + CRON ORDERING (v284, measured 2026-08-23). This lane used to
 * fire at 09:30 and submit anything the preclassifier called a clone at
 * confidence >= 0.7. Result over its lifetime: 2,151 submissions, 1,923 of them
 * DECLINED (89.4%), against ~10 reports Netcraft has ever credited us. The
 * confidence score was measured to have no predictive power over the verdict
 * (1.0 declines at 84.5%, 0.7 at 90.5% — a flat curve), while the urlscan
 * verdict we already store predicts it ~10x better (likely_phishing survives
 * 53.3%, neutral 5.1%). v284 moves the same `likely_phishing OR weaponised`
 * predicate the issue reporter has enforced since v221 into the worklist RPC.
 *
 * The cron time is load-bearing, not cosmetic: urlscan-submit runs 09:00 and
 * urlscan-retrieve runs every 3h on the hour, so no verdict for the batch exists
 * before 12:00. At 09:30 this lane could not have consulted the evidence even
 * if it wanted to — 407 alerts reached Netcraft with no scan at all. 13:00 is
 * chosen to sit AFTER the 12:00 retrieve. If you move retrieve, move this too,
 * or the gate silently starves instead of filtering.
 *
 * Expect ~1-2 submissions/day, not ~25: inflow is ~200 alerts/week of which
 * ~10 are likely_phishing. DAILY_CAP stays 50 as a ceiling, not a target. A
 * run reporting `no_candidates_or_cap_reached` is now the NORMAL case on a
 * quiet day and does not by itself indicate a starved lane.
 *
 * BATCH SIZE IS LOAD-BEARING FOR ESCALATION — do not undo it (measured
 * 2026-08-24). Netcraft permits ONE issue report per submission uuid, and this
 * lane marks every alert in a batch with the SAME uuid. So a batch of N alerts
 * gets N-1 alerts that can never be escalated: they drain in the issue lane as
 * `skipped: "submission_has_issue"`. Pre-v284 batches were 25-37 URLs
 * (08-18..08-22 measured at 25/28/31/37/30), which stranded 25 live weaponised
 * clones; v289 had to add a bypass so the resubmit lane could mint them fresh
 * uuids. Post-v284 the evidence gate makes a batch 1-2 URLs, so one uuid maps
 * to ~one escalatable alert and the problem dissolves.
 *
 * The protection is therefore the EVIDENCE GATE in the worklist RPC, NOT
 * DAILY_CAP. Loosening that predicate re-fattens the batches and silently
 * re-creates the bug. There is deliberately no unit test asserting DAILY_CAP
 * here, because the cap is not what shrank the batches and a test on it would
 * assert a control that is not doing the work. Watch it in prod instead — the
 * query is in docs/ops/clone-watch-config.md § Submission precision.
 */

const NETCRAFT_REPORT_ENDPOINT = "https://report.netcraft.com/api/v3/report/urls";
// Validation-only endpoint: checks the payload, creates no report, sends no
// email. Used by test mode so we never abuse the live intake while validating.
const NETCRAFT_TEST_ENDPOINT = "https://report.netcraft.com/api/v3/test/report/urls";
const DAILY_CAP = 50; // max clones auto-submitted to Netcraft per 24h
const MIN_CONFIDENCE = 0.7;

// ── Weaponised RE-submission lane (v250) ────────────────────────────────────
const RESUBMIT_BRAKE = "clone_netcraft_resubmit";
const RESUBMIT_DEFAULT_CAP = 10;
const RESUBMIT_MIN_AGE_DAYS = 30; // matches the issue reporter's window
const RESUBMIT_COOLDOWN_DAYS = 14;
const RESUBMIT_MAX_PER_ALERT = 3;
// Liveness is only knowable in the caller, so the worklist hands back more rows
// than the day's budget and we submit the first `budget_remaining` LIVE ones.
// Without the over-fetch a batch containing dead rows can never fill the cap.
const RESUBMIT_PROBE_MULTIPLIER = 3;
// Proved-dead rows are deferred, not dropped: 5 rounds at 7 days each, then a
// terminal skip (~35 days continuously NXDOMAIN). v248's shape.
const RESUBMIT_DEAD_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const RESUBMIT_DEAD_MAX_ROUNDS = 5;

function resubmitCap(): number {
  const raw = Number.parseInt(process.env.NETCRAFT_RESUBMIT_DAILY_CAP ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : RESUBMIT_DEFAULT_CAP;
}

/** Row shape returned by list_clone_alerts_pending_netcraft_resubmit. */
export interface NetcraftResubmitCandidate {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string | null;
  urlscan_uuid: string | null;
  weaponised_at: string | null;
  /** 24h submission allowance left, identical on every row (v252). */
  budget_remaining?: number | null;
}

/**
 * Pure builder for the RE-submission body. Distinct reason text from the
 * auto-report lane: this batch is not "please classify these lookalikes", it is
 * "we watched these turn into live phishing and you have no open record of
 * them" — which is the whole justification for re-approaching Netcraft on a URL
 * they may have seen before. Cites the urlscan evidence so a human reviewer can
 * verify rather than take our word.
 */
export function buildNetcraftResubmitBody(
  candidates: NetcraftResubmitCandidate[],
  reporterEmail: string,
): NetcraftBulkBody {
  const seen = new Set<string>();
  const urls: Array<{ url: string; country: string }> = [];
  for (const c of candidates) {
    if (!c.candidate_url || seen.has(c.candidate_url)) continue;
    seen.add(c.candidate_url);
    urls.push({ url: c.candidate_url, country: "AU" });
  }
  const evidence = candidates
    .filter((c) => c.urlscan_uuid)
    .slice(0, 10)
    .map(
      (c) =>
        `${c.candidate_domain} (impersonating ${c.inferred_target_domain ?? "an Australian brand"}): https://urlscan.io/result/${c.urlscan_uuid}/`,
    );
  return {
    email: reporterEmail,
    reason:
      "Confirmed phishing on Australian-brand lookalike domains, detected by " +
      "Ask Arthur clone-watch (askarthur.au). Each of these was monitored from " +
      "registration and has since been observed serving suspected " +
      "credential-harvest or payment-fraud content by our own urlscan.io scan. " +
      "They are being reported fresh because no current Netcraft submission " +
      "covers them. Scan evidence:\n" +
      (evidence.length ? evidence.join("\n") : "(scan references unavailable)"),
    urls,
  };
}

/** Row shape returned by list_clone_alerts_pending_netcraft_auto. */
export interface NetcraftAutoCandidate {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string;
  severity_tier: string | null;
  signals: unknown;
}

export interface NetcraftBulkBody {
  email: string;
  reason: string;
  urls: Array<{ url: string; country: string }>;
}

export interface NetcraftBulkResult {
  ok: boolean;
  status: number;
  uuid: string | null;
  state: string | null;
  errText: string | null;
  raw: Record<string, unknown>;
  urlCount: number;
}

/**
 * The one place either lane talks to Netcraft's bulk intake.
 *
 * `test: true` targets the validation-only endpoint — it checks the payload,
 * creates NO report and sends NO confirmation email. Both lanes route through
 * here so "which endpoint does test mode hit" is a single decision with a
 * single test, rather than a duplicated ternary per lane. Never throws: the
 * callers soft-fail a non-2xx into a $0 diagnostic, because an Inngest fn error
 * pages the Axiom fleet watch.
 */
export async function postNetcraftBulk(
  body: NetcraftBulkBody,
  opts: { test: boolean },
): Promise<NetcraftBulkResult> {
  const apiKey = process.env.NETCRAFT_REPORT_API_KEY;
  const res = await fetch(
    opts.test ? NETCRAFT_TEST_ENDPOINT : NETCRAFT_REPORT_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return {
    ok: res.ok,
    status: res.status,
    uuid: typeof parsed.uuid === "string" ? parsed.uuid : null,
    state: typeof parsed.state === "string" ? parsed.state : null,
    errText: res.ok ? null : text.slice(0, 200),
    raw: parsed,
    urlCount: body.urls.length,
  };
}

/**
 * Pure builder for the bulk Netcraft report body. One batch-level reason (the
 * bulk endpoint takes a single reason for all urls); each url is AU. Dedupes
 * urls so the same candidate_url isn't sent twice in one batch.
 */
export function buildNetcraftBulkBody(
  candidates: NetcraftAutoCandidate[],
  reporterEmail: string,
): NetcraftBulkBody {
  const seen = new Set<string>();
  const urls: Array<{ url: string; country: string }> = [];
  for (const c of candidates) {
    if (!c.candidate_url || seen.has(c.candidate_url)) continue;
    seen.add(c.candidate_url);
    urls.push({ url: c.candidate_url, country: "AU" });
  }
  return {
    email: reporterEmail,
    reason:
      "Possible clones / lookalike-typosquat domains of Australian brands, " +
      "detected via Ask Arthur clone-watch's daily NRD lexical sweep " +
      "(askarthur.au brand watchlist; high-confidence preclassifier matches). " +
      "Submitted in good faith for Netcraft classification.",
    urls,
  };
}

export const cloneWatchNetcraftAuto = inngest.createFunction(
  {
    id: "shopfront-clone-netcraft-auto",
    name: "Clone-Watch: Netcraft auto-report producer (bulk, gated)",
    retries: 1,
    singleton: { mode: "skip" },
    // 6m (was 4m): the v250 resubmit lane adds a liveness sweep + a second
    // bulk POST. Still under the 10m pg-stuck-query-watchdog edge, and the slow
    // part is external HTTP rather than a PG backend.
    timeouts: { finish: "6m" },
  },
  [
    // 13:00 UTC — deliberately AFTER urlscan-retrieve's 12:00 pass, so the
    // v284 evidence gate has a verdict to read. See the header note.
    { cron: "0 13 * * *" },
    { event: "shopfront/clone.netcraft-auto.producer.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-netcraft-auto" },
    async ({ event, step }) => {
      // Test mode validates the payload against Netcraft's test endpoint only —
      // no report, no email, no persistence. Bypasses the FF gate so we can
      // prove the path works while the feature is still dark.
      const isTest = (event?.data as { test?: unknown } | undefined)?.test === true;

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // The two lanes are independently gated and independently braked, so the
      // auto lane's guards can no longer return from the whole function —
      // FF_SHOPFRONT_CLONE_NETCRAFT_AUTO being off must not silence the
      // resubmit lane. Both share the one bulk-POST shape below.
      //
      // SEQUENTIAL ON PURPOSE — do not turn this into a Promise.all. A
      // weaponised alert that was never submitted qualifies for BOTH
      // worklists; the auto lane stamps netcraft.submitted_at before the
      // resubmit worklist is loaded, which is the only thing stopping the same
      // URL being POSTed twice in one run. Overlap measured 0 on 2026-07-26,
      // but only because of this ordering.
      const autoResult = await runAutoLane();
      const resubmitResult = await runResubmitLane();
      return { ...autoResult, resubmit: resubmitResult };

      async function runAutoLane() {
      if (!isTest && !featureFlags.shopfrontCloneNetcraftAuto) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_NETCRAFT_AUTO disabled" };
      }
      if (
        !isTest &&
        (!featureFlags.shopfrontCloneSubmitNetcraft ||
          !featureFlags.shopfrontCloneOutreach)
      ) {
        return { skipped: true, reason: "netcraft_submit_or_outreach_disabled" };
      }

      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      const candidates = await step.run("load-candidates", async () => {
        const { data, error } = await sb.rpc(
          "list_clone_alerts_pending_netcraft_auto",
          { p_min_confidence: MIN_CONFIDENCE, p_daily_cap: DAILY_CAP },
        );
        if (error) {
          logger.error("netcraft-auto: candidate fetch failed", {
            error: error.message,
          });
          return [] as NetcraftAutoCandidate[];
        }
        return (data as NetcraftAutoCandidate[] | null) ?? [];
      });

      if (candidates.length === 0) {
        // Either the daily cap is exhausted or there are no pending candidates.
        return { ok: true, test: isTest, candidates: 0, submitted: 0, reason: "no_candidates_or_cap_reached" };
      }

      // ONE bulk request for the whole (≤50) batch — no per-request flood.
      // Test mode hits the validation-only endpoint (no report, no email).
      const result = await step.run("submit-netcraft-bulk", () =>
        postNetcraftBulk(
          buildNetcraftBulkBody(
            candidates,
            process.env.NETCRAFT_REPORTER_EMAIL ?? "brendan@askarthur.au",
          ),
          { test: isTest },
        ),
      );

      // Test mode: report the validation outcome, persist NOTHING.
      if (isTest) {
        logger.info("netcraft-auto: TEST-endpoint validation", {
          ok: result.ok,
          status: result.status,
          urlCount: result.urlCount,
          response: result.raw,
        });
        return {
          ok: result.ok,
          test: true,
          validated: result.ok,
          status: result.status,
          urlCount: result.urlCount,
          response: result.raw,
        };
      }

      if (!result.ok) {
        // Soft-fail: $0 diagnostic so the daily digest surfaces it, but do NOT
        // throw — a transient Netcraft non-2xx must not raise an Inngest fn
        // error (which pages the Axiom fleet watch). Left unmarked → retried
        // next run.
        await step.run("log-submit-failure", async () => {
          logCost({
            feature: "shopfront-clone-netcraft-auto-error",
            provider: "netcraft",
            operation: "bulk_submit",
            units: result.urlCount,
            unitCostUsd: 0,
            metadata: { status: result.status, error: result.errText },
          });
        });
        logger.warn("netcraft-auto: bulk submit non-2xx (will retry next run)", {
          status: result.status,
          urlCount: result.urlCount,
        });
        return { ok: false, candidates: candidates.length, submitted: 0, status: result.status };
      }

      // Mark every alert in the batch submitted (atomic per-alert JSONB merge,
      // same RPC the per-candidate worker uses) with the batch uuid.
      const marked = await step.run("persist-submissions", async () => {
        const submittedAt = new Date().toISOString();
        let n = 0;
        for (const c of candidates) {
          const { error } = await sb.rpc("merge_clone_alert_submission", {
            p_alert_id: c.id,
            p_key: "netcraft",
            p_value: {
              uuid: result.uuid,
              state: result.state,
              submitted_at: submittedAt,
              via: "auto_bulk",
            },
            p_set_triage_status: "tp_actioned",
          });
          if (error) {
            logger.error("netcraft-auto: mark-submitted failed", {
              alertId: c.id,
              error: error.message,
            });
          } else {
            n++;
          }
        }
        return n;
      });

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_netcraft_auto",
          provider: "netcraft",
          operation: "bulk_submit",
          units: marked,
          unitCostUsd: 0, // keyless intake
          metadata: { candidates: candidates.length, marked, netcraft_uuid: result.uuid },
        });
      });

      logger.info("netcraft-auto: bulk submission complete", {
        candidates: candidates.length,
        marked,
        netcraftUuid: result.uuid,
      });

      return { ok: true, candidates: candidates.length, submitted: marked, netcraftUuid: result.uuid };
      }

      /**
       * v250 — weaponised RE-submission lane.
       *
       * 23 of 54 weaponised clones have no Netcraft submission the F4 issue
       * reporter can escalate against: 3 were never submitted, 20 have aged
       * past the reporter's 30-day window (report_issue 404s once Netcraft
       * archives a submission). They are simply dropped today. A fresh report
       * is also the stronger move — it carries our urlscan phishing evidence,
       * where report_issue only argues against a verdict already recorded.
       *
       * Reporter standing is the real risk, so the bounds are deliberately
       * conservative and layered: weaponised-only, liveness-confirmed,
       * never-successfully-escalated, a 14-day per-alert cooldown, a hard
       * 3-resubmit ceiling per alert, a 24h global budget (so re-firing the
       * manual trigger cannot exceed the day's allowance), the FP-brand
       * denylist, and its own kill-switch pair (FF_CLONE_NETCRAFT_RESUBMIT +
       * feature_brakes.clone_netcraft_resubmit).
       *
       * v252 — the worklist over-fetches (probe limit) and the 24h budget
       * arrives as `budget_remaining` rather than bounding the row count,
       * because liveness is only knowable here. Proved-dead rows are DEFERRED
       * (7 days, 5 rounds, then terminal), never merely filtered: an unstamped
       * dead row returns at the head of the ordering every single day and
       * silently eats the daily cap.
       */
      async function runResubmitLane() {
        // Test mode bypasses the gates exactly as the auto lane does, so the
        // validation-only endpoint can exercise this lane while it is dark.
        // It used to return HERE, ahead of everything — which meant
        // `{ test: true }` validated the auto lane's payload and silently
        // covered none of this one, the only novel payload of the two.
        if (!isTest && !featureFlags.cloneNetcraftResubmit) {
          return { skipped: true, reason: "FF_CLONE_NETCRAFT_RESUBMIT disabled" };
        }
        if (
          !isTest &&
          (!featureFlags.shopfrontCloneSubmitNetcraft ||
            !featureFlags.shopfrontCloneOutreach)
        ) {
          return { skipped: true, reason: "netcraft_submit_or_outreach_disabled" };
        }
        if (!sb) return { skipped: true, reason: "supabase_unavailable" };

        // The brake is an operator kill-switch on SUBMITTING. Test mode files
        // nothing, so it is not gated on it — but the check is skipped rather
        // than ignored, to keep the braked state out of a validation run's
        // step history.
        const braked = isTest
          ? false
          : await step.run("resubmit-check-brake", () =>
              isFeatureBraked(RESUBMIT_BRAKE),
            );
        if (braked) {
          return { skipped: true, reason: `feature_brakes.${RESUBMIT_BRAKE} engaged` };
        }

        const pending = await step.run("resubmit-load-candidates", async () => {
          const { data, error } = await sb.rpc(
            "list_clone_alerts_pending_netcraft_resubmit",
            {
              p_limit: resubmitCap(),
              p_min_age_days: RESUBMIT_MIN_AGE_DAYS,
              p_cooldown_days: RESUBMIT_COOLDOWN_DAYS,
              p_max_resubmits: RESUBMIT_MAX_PER_ALERT,
              p_probe_limit: resubmitCap() * RESUBMIT_PROBE_MULTIPLIER,
            },
          );
          if (error) {
            logger.error("netcraft-resubmit: candidate fetch failed", {
              error: error.message,
            });
            return [] as NetcraftResubmitCandidate[];
          }
          // The RPC has no brand column to filter on, so the v176 FP-brand
          // denylist is applied here exactly as the issue reporter does it —
          // reporting a generic-dictionary-word "brand" match would flag
          // legitimate sites and burn the standing this lane depends on.
          return ((data as NetcraftResubmitCandidate[] | null) ?? []).filter(
            (c) => !isFpBrand(c.inferred_target_domain ?? ""),
          );
        });

        if (pending.length === 0) {
          return { ok: true, candidates: 0, submitted: 0, reason: "none_pending_or_cap" };
        }

        // Liveness gate, same three-valued rule as the issue reporter (v248):
        // only a PROVED-dead host is dropped. A TLS failure or a refused
        // connect is not death — it is usually a phishing kit blocking our
        // egress — and treating it as such is what starved the reporter.
        const liveness = await step.run("resubmit-liveness", async () => {
          const map = await probeLivenessDetailed(pending.map((c) => c.candidate_url));
          return Object.fromEntries(map);
        });
        const liveAll = pending.filter(
          (c) => liveness[c.candidate_url]?.live !== false,
        );
        const deadRows = pending.filter(
          (c) => liveness[c.candidate_url]?.live === false,
        );
        const dead = deadRows.length;

        // v252 — defer the dead ones, do NOT merely skip them. The worklist
        // rank-limits before liveness is knowable, so an unstamped dead row
        // returns at the head of the ordering tomorrow and every day after:
        // 9 of the 23 eligible were NXDOMAIN on 2026-07-26, which projected to
        // 9 of 10 daily slots permanently spent on domains that no longer
        // exist, with the lane still returning ok:true. Bounded and
        // non-terminal for 5 rounds — a revived host re-enters.
        //
        // This runs BEFORE the submit and before every early return below, so
        // the all-dead day still makes progress. Nothing is deferred under
        // test.
        const deferred =
          isTest || deadRows.length === 0
            ? 0
            : await step.run("resubmit-defer-dead", async () => {
                const { data, error } = await sb.rpc(
                  "defer_clone_alert_netcraft_resubmit",
                  {
                    p_alert_ids: deadRows.map((c) => c.id),
                    p_reason: "dead_at_probe",
                    p_recheck_after: new Date(
                      Date.now() + RESUBMIT_DEAD_RECHECK_MS,
                    ).toISOString(),
                    p_max_rounds: RESUBMIT_DEAD_MAX_ROUNDS,
                  },
                );
                if (error) {
                  // Non-fatal: the batch's live rows are still worth filing.
                  // Loud, though — a silent failure here IS the starvation.
                  logger.warn("netcraft-resubmit: dead-row deferral failed", {
                    error: error.message,
                    alertIds: deadRows.map((c) => c.id),
                  });
                  return 0;
                }
                return typeof data === "number" ? data : 0;
              });

        // The 24h budget bounds SUBMISSIONS; the over-fetch above only widened
        // what we probe. Defaults to the cap when the column is absent (an old
        // deployment reading the new RPC, or vice versa).
        const budget = Math.max(
          0,
          pending[0]?.budget_remaining ?? resubmitCap(),
        );
        const live = liveAll.slice(0, budget);

        // Nothing to file — but under test the point is to validate the payload
        // SHAPE, and an all-dead batch on the day of the run must not silently
        // skip that. Fall through with the pending rows instead.
        if (live.length === 0 && !isTest) {
          logger.info("netcraft-resubmit: all candidates proved dead, nothing to file", {
            candidates: pending.length,
            deferred,
          });
          return {
            ok: true,
            candidates: pending.length,
            submitted: 0,
            dead,
            deferred,
            reason: "all_dead",
          };
        }
        const batch = live.length > 0 ? live : pending;

        const result = await step.run("resubmit-submit-bulk", () =>
          postNetcraftBulk(
            buildNetcraftResubmitBody(
              batch,
              process.env.NETCRAFT_REPORTER_EMAIL ?? "brendan@askarthur.au",
            ),
            { test: isTest },
          ),
        );

        // Validation only: report the outcome, persist NOTHING, log no cost.
        // This is the pre-flight the live lane never had — the resubmit reason
        // is a multi-line block carrying up to 10 urlscan URLs, where the
        // proven auto-lane reason is one short paragraph, and Netcraft's limit
        // on that field is unverified.
        if (isTest) {
          logger.info("netcraft-resubmit: TEST-endpoint validation", {
            ok: result.ok,
            status: result.status,
            urlCount: result.urlCount,
            response: result.raw,
          });
          return {
            ok: result.ok,
            test: true,
            validated: result.ok,
            status: result.status,
            candidates: pending.length,
            urlCount: result.urlCount,
            dead,
            response: result.raw,
          };
        }

        // Soft-fail like the auto lane: a transient Netcraft non-2xx is a $0
        // diagnostic, not an Inngest fn error (which would page the fleet
        // watch). Unmarked rows are retried next run.
        if (!result.ok || !result.uuid) {
          await step.run("resubmit-log-failure", async () => {
            logCost({
              feature: "shopfront-clone-netcraft-resubmit-error",
              provider: "netcraft",
              operation: "resubmit_bulk",
              units: result.urlCount,
              unitCostUsd: 0,
              metadata: { status: result.status, error: result.errText },
            });
          });
          logger.warn("netcraft-resubmit: bulk submit failed (retry next run)", {
            status: result.status,
            urlCount: result.urlCount,
          });
          return {
            ok: false,
            candidates: pending.length,
            submitted: 0,
            dead,
            deferred,
            status: result.status,
          };
        }

        const marked = await step.run("resubmit-persist", async () => {
          const { data, error } = await sb.rpc(
            "record_clone_alert_netcraft_resubmit",
            {
              p_alert_ids: live.map((c) => c.id),
              p_uuid: result.uuid,
              p_state: result.state,
            },
          );
          if (error) {
            // The POST already succeeded, so these URLs ARE reported but carry
            // no resubmitted_at — no cooldown applies and the next run reports
            // them again. Emit the uuid and the ids as a $0 diagnostic before
            // rethrowing, or the only record of what Netcraft holds dies with
            // the exception.
            logCost({
              feature: "shopfront-clone-netcraft-resubmit-error",
              provider: "netcraft",
              operation: "resubmit_persist",
              units: live.length,
              unitCostUsd: 0,
              metadata: {
                error: error.message,
                netcraft_uuid: result.uuid,
                alert_ids: live.map((c) => c.id),
                unmarked: true,
              },
            });
            throw new Error(
              `record_clone_alert_netcraft_resubmit failed (${live.length}): ${error.message}`,
            );
          }
          return typeof data === "number" ? data : 0;
        });

        await step.run("resubmit-log-cost", async () => {
          logCost({
            feature: "shopfront_clone_netcraft_resubmit",
            provider: "netcraft",
            operation: "resubmit_bulk",
            units: marked,
            unitCostUsd: 0, // keyless intake
            metadata: {
              candidates: pending.length,
              live: live.length,
              dead,
              deferred,
              budget,
              marked,
              netcraft_uuid: result.uuid,
              brands: [
                ...new Set(live.map((c) => c.inferred_target_domain ?? "unknown")),
              ],
              // The probe verdict is the diagnostic a bare count throws away —
              // without it, a dead verdict needs a live re-probe to explain,
              // and by then the answer has changed (the v248 lesson).
              dead_reasons: deadRows.map((c) => ({
                domain: c.candidate_domain,
                reason: liveness[c.candidate_url]?.reason ?? "unknown",
              })),
            },
          });
        });

        logger.info("netcraft-resubmit: complete", {
          candidates: pending.length,
          live: live.length,
          dead,
          deferred,
          budget,
          marked,
          netcraftUuid: result.uuid,
        });

        return {
          ok: true,
          candidates: pending.length,
          submitted: marked,
          dead,
          deferred,
          netcraftUuid: result.uuid,
        };
      }
    },
  ),
);
