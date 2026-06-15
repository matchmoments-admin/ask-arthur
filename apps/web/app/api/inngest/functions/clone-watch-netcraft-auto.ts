import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

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
    timeouts: { finish: "4m" },
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

      const sb = createServiceClient();
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
      const result = await step.run("submit-netcraft-bulk", async () => {
        const body = buildNetcraftBulkBody(
          candidates,
          process.env.NETCRAFT_REPORTER_EMAIL ?? "brendan@askarthur.au",
        );
        const apiKey = process.env.NETCRAFT_REPORT_API_KEY;
        const res = await fetch(
          isTest ? NETCRAFT_TEST_ENDPOINT : NETCRAFT_REPORT_ENDPOINT,
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
      });

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
    },
  ),
);
