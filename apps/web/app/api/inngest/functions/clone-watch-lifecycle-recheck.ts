import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { computeWeaponisationRisk } from "@/lib/clone-watch/weaponisation-risk";
import { submitCloneCandidate } from "@/lib/clone-watch/urlscan-submit-one";

/**
 * Clone-Watch — lifecycle re-check loop (Wave 0 PR-B).
 *
 * The founder's "we need to press these somehow" ask, in code. Netcraft grades
 * on LIVE content, so a lookalike that is parked / cloaked / pre-weaponisation
 * at first scan comes back "no threats" (→ lifecycle 'declined') or benign
 * (→ 'monitoring'). Those domains very often weaponise LATER. This cron re-scans
 * the 'monitoring'/'declined' tail on a cadence: when the re-scan verdict flips
 * to likely_phishing, clone-watch-urlscan-retrieve promotes the alert to
 * 'weaponised' and emits shopfront/clone.weaponised.v1 — the contradiction we
 * exploit ("we saw the phish, Netcraft didn't").
 *
 * v224 (ops review): rescans are submitted INLINE here (one step.run per
 * candidate, mirroring clone-watch-urlscan-submit), NOT fanned out as 50
 * scan-requested events to scan-one — that fan-out was ~200 Inngest
 * invocations/day of the operator-single-click path. The daily throttle keeps
 * total rescans structurally bounded (the May-27 lesson); a manual-trigger
 * cooldown prevents same-hour stacking (which breached urlscan's 100/hour
 * unlisted cap). The retrieve stage picks up the fresh submissions (v224 also
 * fixed retrieve to see re-submitted-since-last-scan rows, so classified rows
 * that flip are finally detectable).
 *
 * Gated by FF_SHOPFRONT_CLONE_RECHECK (canary independently of Netcraft
 * submission) + a feature_brakes.shopfront_clone_recheck operator kill-switch.
 */

const RECHECK_BATCH_LIMIT = 50; // × 4 runs/day = ≤200 rescans/day, bounded
// F3: over-fetch the staleness-ordered pool, rank by weaponisation risk in TS
// (ONE scorer — weaponisation-risk.ts), rescan the top 50. Unselected rows
// keep their stale last_rechecked_at and rotate through on later runs
// (staleness-ordered pool → no starvation; full ~800-row rotation ≈ 4 days).
const RECHECK_FETCH_LIMIT = 200;
const RECHECK_CADENCE_HOURS = 6; // don't re-scan the same domain more often
const BRAKE = "shopfront_clone_recheck";

interface RecheckRow {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  lifecycle_state: string;
  urlscan_classification: string | null;
  recheck_count: number;
  last_rechecked_at: string | null;
  // v222 risk-score inputs (all nullable — enrichment/classification partial).
  signals: unknown;
  attribution: {
    whois?: { createdDate?: string };
    ip_rep?: { abuseConfidenceScore?: number };
  } | null;
  clf_is_clone: boolean | null;
  clf_confidence: number | null;
  clf_attack_intent: string | null;
  clf_clone_tactic: string | null;
  brand_category: string | null;
}

/** Rank the fetched pool: risk desc, then staleness (asc, nulls first), then
 *  id — deterministic. Exported for unit tests. */
export function selectTopRiskCandidates(
  rows: RecheckRow[],
  limit: number,
  nowMs: number,
): Array<RecheckRow & { risk: number }> {
  const scored = rows.map((r) => ({
    ...r,
    risk: computeWeaponisationRisk({
      urlscanClassification: r.urlscan_classification,
      signals: r.signals,
      isClone: r.clf_is_clone,
      confidence: r.clf_confidence,
      attackIntent: r.clf_attack_intent,
      brandCategory: r.brand_category,
      whoisCreatedDate: r.attribution?.whois?.createdDate ?? null,
      ipAbuseConfidenceScore: r.attribution?.ip_rep?.abuseConfidenceScore ?? null,
      nowMs,
    }).score,
  }));
  scored.sort((a, b) => {
    if (a.risk !== b.risk) return b.risk - a.risk;
    const ta = a.last_rechecked_at ? Date.parse(a.last_rechecked_at) : -Infinity;
    const tb = b.last_rechecked_at ? Date.parse(b.last_rechecked_at) : -Infinity;
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });
  return scored.slice(0, limit);
}

export const cloneWatchLifecycleRecheck = inngest.createFunction(
  {
    id: "shopfront-clone-lifecycle-recheck",
    name: "Clone-Watch: lifecycle re-check loop",
    retries: 1,
    concurrency: { limit: 1 },
    // Structural daily ceiling on inline urlscan submits (4 crons × 50 = 200
    // < 210), so a worklist regression / manual-trigger storm can't recreate
    // the May-27 urlscan burst (v224).
    throttle: { limit: 210, period: "1d" },
    // 8m: up to 50 sequential urlscan submits (HTTP) per run + marks. Still
    // well under the 10m pg-stuck-query-watchdog edge (the slow part is
    // external HTTP, not PG).
    timeouts: { finish: "8m" },
  },
  [
    // Offset from urlscan-retrieve (0 */3) so a rescan submit and a retrieve
    // tick don't race on the same row (v224).
    { cron: "30 */6 * * *" },
    { event: "shopfront/clone.lifecycle-recheck.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-lifecycle-recheck" },
    async ({ step }) => {
      if (!featureFlags.shopfrontCloneRecheck) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_RECHECK disabled" };
      }
      // The re-check loop's ONLY job is to trigger urlscan re-scans. If the
      // urlscan pipeline can't run, don't mark candidates rechecked (which would
      // bump last_rechecked_at and exclude them for a full cadence with no scan).
      if (!featureFlags.shopfrontCloneUrlscan) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_URLSCAN disabled" };
      }
      if (!process.env.URLSCAN_API_KEY) {
        return { skipped: true, reason: "URLSCAN_API_KEY not set" };
      }
      const braked = await step.run("check-brake", () => isFeatureBraked(BRAKE));
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // Cooldown: skip if a recheck ran in the last 50 min. The 6h-apart crons
      // never trip this; it exists so rapid MANUAL triggers can't stack three
      // 50-submit runs into one hour and breach urlscan's 100/hour unlisted cap
      // (which happened 2026-07-12 00:00 UTC). The throttle is the structural
      // backstop; this is the operator-ergonomics one.
      const recentRun = await step.run("check-cooldown", async () => {
        const { data } = await sb
          .from("cost_telemetry")
          .select("created_at")
          .eq("feature", "shopfront_clone_recheck")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data?.created_at) return false;
        return Date.now() - new Date(data.created_at).getTime() < 50 * 60 * 1000;
      });
      if (recentRun) {
        return { skipped: true, reason: "cooldown_active" };
      }

      const pool = await step.run("load-recheck-candidates", async () => {
        const { data } = await sb.rpc("list_clone_alerts_for_recheck", {
          p_limit: RECHECK_FETCH_LIMIT,
          p_cadence_hours: RECHECK_CADENCE_HOURS,
        });
        return (data as RecheckRow[] | null) ?? [];
      });

      if (pool.length === 0) {
        return { ok: true, rechecked: 0, reason: "nothing_due" };
      }

      // F3: rank the pool by weaponisation risk and rescan the top slice first.
      // Inside step.run so the ranking (which reads the clock for domain age)
      // is replay-stable.
      const candidates = await step.run("rank-by-risk", async () =>
        selectTopRiskCandidates(pool, RECHECK_BATCH_LIMIT, Date.now()),
      );

      // Submit each rescan INLINE — one step.run per candidate for independent
      // memoisation (a single failure doesn't replay the whole batch or
      // re-submit already-submitted rows), mirroring clone-watch-urlscan-submit.
      // Replaces the old 50-event fan-out to scan-one (~200 invocations/day).
      let submitted = 0;
      let submitFailed = 0;
      let reputationHits = 0;
      for (const c of candidates) {
        const outcome = await step.run(`submit-${c.id}`, () =>
          submitCloneCandidate({
            id: c.id,
            candidate_url: c.candidate_url,
            candidate_domain: c.candidate_domain,
          }),
        );
        if (outcome.reputationMalicious) reputationHits++;
        if (
          outcome.kind === "submitted" ||
          outcome.kind === "reputation_classified"
        ) {
          submitted++;
        } else {
          submitFailed++;
        }
      }

      // Mark each candidate rechecked (bump recheck_count + last_rechecked_at)
      // via the same guarded transition RPC, holding lifecycle_state unchanged
      // so it drops out of the cadence window until the re-scan verdict lands.
      await step.run("mark-rechecked", async () => {
        for (const c of candidates) {
          const { error } = await sb.rpc("advance_clone_lifecycle", {
            p_alert_id: c.id,
            p_to_state: c.lifecycle_state, // no-op state change; just re-check bookkeeping
            p_mark_rechecked: true,
          });
          if (error) {
            throw new Error(
              `advance_clone_lifecycle(mark_rechecked) failed for alert ${c.id}: ${error.message}`,
            );
          }
        }
      });

      // Two telemetry rows: the risk-score distribution (weight-tuning
      // feedstock) under the recheck feature, AND the urlscan submit VOLUME
      // under the urlscan feature — the recheck path is now the dominant
      // urlscan caller and was previously invisible to the cost dashboard /
      // volume ceilings (v224).
      await step.run("log-cost", async () => {
        const risks = candidates.map((c) => c.risk).sort((a, b) => a - b);
        logCost({
          feature: "shopfront_clone_recheck",
          provider: "internal",
          operation: "recheck_batch",
          units: candidates.length,
          unitCostUsd: 0,
          metadata: {
            rechecked: candidates.length,
            pool: pool.length,
            submitted,
            submit_failed: submitFailed,
            declined: candidates.filter((c) => c.lifecycle_state === "declined")
              .length,
            monitoring: candidates.filter(
              (c) => c.lifecycle_state === "monitoring",
            ).length,
            top_score: risks[risks.length - 1] ?? null,
            median_score: risks[Math.floor(risks.length / 2)] ?? null,
            bands: {
              critical: candidates.filter((c) => c.risk >= 70).length,
              elevated: candidates.filter((c) => c.risk >= 40 && c.risk < 70)
                .length,
              low: candidates.filter((c) => c.risk < 40).length,
            },
          },
        });
        logCost({
          feature: "shopfront_clone_urlscan",
          provider: "urlscan",
          operation: "recheck_submit",
          units: submitted,
          unitCostUsd: 0, // free tier
          metadata: { submitted, submit_failed: submitFailed, reputation_hits: reputationHits },
        });
      });

      logger.info("clone-watch lifecycle re-check: complete", {
        rechecked: candidates.length,
        pool: pool.length,
        submitted,
        submitFailed,
      });

      return {
        ok: true,
        rechecked: candidates.length,
        pool: pool.length,
        submitted,
        submitFailed,
      };
    },
  ),
);
