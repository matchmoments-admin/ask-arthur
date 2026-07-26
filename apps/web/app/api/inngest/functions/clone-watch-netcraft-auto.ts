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
 * Cron 09:30 UTC + a manual-trigger event.
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
    { cron: "30 9 * * *" },
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
       * 3-resubmit ceiling per alert, a 24h global budget folded into the
       * worklist's LIMIT (so re-firing the manual trigger cannot exceed the
       * day's allowance), the FP-brand denylist, and its own kill-switch pair
       * (FF_CLONE_NETCRAFT_RESUBMIT + feature_brakes.clone_netcraft_resubmit).
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
        const live = pending.filter(
          (c) => liveness[c.candidate_url]?.live !== false,
        );
        const dead = pending.length - live.length;

        // Nothing to file — but under test the point is to validate the payload
        // SHAPE, and an all-dead batch on the day of the run must not silently
        // skip that. Fall through with the pending rows instead.
        if (live.length === 0 && !isTest) {
          logger.info("netcraft-resubmit: all candidates proved dead, nothing to file", {
            candidates: pending.length,
          });
          return { ok: true, candidates: pending.length, submitted: 0, dead, reason: "all_dead" };
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
              marked,
              netcraft_uuid: result.uuid,
              brands: [
                ...new Set(live.map((c) => c.inferred_target_domain ?? "unknown")),
              ],
            },
          });
        });

        logger.info("netcraft-resubmit: complete", {
          candidates: pending.length,
          live: live.length,
          dead,
          marked,
          netcraftUuid: result.uuid,
        });

        return {
          ok: true,
          candidates: pending.length,
          submitted: marked,
          dead,
          netcraftUuid: result.uuid,
        };
      }
    },
  ),
);
