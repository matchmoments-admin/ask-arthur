import { inngest } from "@askarthur/scam-engine/inngest/client";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import {
  DB_WRITE_CONCURRENCY,
  groupBy,
  mapWithConcurrency,
  NO_WRITES,
  type WriteOutcome,
} from "@askarthur/utils/concurrency";
import {
  enrichCloneAttribution,
  type HostingInfo,
} from "@/lib/clone-watch/enrich-attribution";
import { computeCampaignKey } from "@/lib/clone-watch/campaign-fingerprint";
import { searchURLScan } from "@askarthur/scam-engine/urlscan-search";
import {
  NO_KIT_PIVOTS,
  runKitPivots,
  type KitPivotOutcome,
  type KitPivotRow,
} from "@/lib/clone-watch/kit-pivot";

/**
 * Clone-watch attribution enricher (Phase 2). Builds the per-clone dossier —
 * WHOIS (registrar / created / registrant country), Certificate-Transparency
 * siblings (one operator's campaign), and IP abuse reputation — for confirmed
 * clones, reusing the existing scam-engine helpers.
 *
 * Covers BOTH auto-triaged (#575) and manually-confirmed alerts uniformly via a
 * classification-absence selector (tp_confirmed AND attribution IS NULL),
 * decoupled from how the alert got confirmed. The hosting IP/country/ASN comes
 * from urlscan_evidence.server (already captured); the helpers add the rest.
 *
 * Gated FF_CLONE_WATCH_ATTRIBUTION (default OFF). Brake: the shared
 * shopfront_clone_outreach $5/day cap (helpers are free-tier — whois/CT/geo $0,
 * AbuseIPDB free — so this is cheap; the cap is a backstop). Bounded at
 * ENRICH_RUN_CAP/run; runs daily just after auto-triage.
 */

const BRAKE = "shopfront_clone_outreach";
// Bumped 15 → 60: attribution now feeds the monthly Brand Stewardship email,
// which lists registrar + abuse contact for EVERY detected clone (not just
// operator-confirmed ones), so the enricher must keep pace with the full NRD
// detection volume (~30/day). WHOIS/CT/geo are free-tier ($0); the run is still
// brake-capped + bounded by this cap.
const ENRICH_RUN_CAP = 60;
const RECENT_WINDOW_DAYS = 35; // covers a full prior calendar month for the report
// Bounded per-run campaign_key backfill of already-enriched rows (converges to
// zero over a few days; the "insufficient" sentinel keeps it self-draining).
const BACKFILL_CAP = 500;
// urlscan Search API is rate-limited (free tier), so pivot at most this many
// confirmed-phishing clones per run.
const KIT_PIVOT_RUN_CAP = 10;

/**
 * In-step wall-clock budget for the kit-pivot loop, in milliseconds.
 *
 * IN-STEP, not spanning: the loop lives wholly inside ONE `step.run`, so its
 * bound is the route's `maxDuration` (Vercel kills the request), not
 * `timeouts.finish`. The clock therefore starts at step entry, which
 * `budgetedStep` guarantees by construction — see step-budget.ts.
 *
 * Worst case today is ~81s: KIT_PIVOT_RUN_CAP (10) rows x an 8s
 * `searchURLScan` abort plus one DB write each, sequential. 120s is enough
 * that a healthy run never sees it and small enough that a pathological one
 * cannot approach the 300s request budget. It is a backstop, not the
 * mechanism — the run cap is what sizes this step.
 *
 * Stopping early is safe: a row the budget did not reach keeps
 * `kit_siblings IS NULL` and is selected again tomorrow.
 */
const KIT_PIVOT_WALL_CLOCK_MS = 120_000;

interface PendingAlert {
  id: number;
  candidate_domain: string;
  urlscan_evidence: { server?: HostingInfo } | null;
}

// inngest-finish-budget: 64 boundaries — 4 static + 1 per-item enrich step x
// ENRICH_RUN_CAP (60). The single largest per-item fan-out in the lane;
// batching it is the highest-value fold available. See #1074.
//
// The floor is therefore 64 x 30s = 1920s of queue wait + 120s inline
// (KIT_PIVOT_WALL_CLOCK_MS) + 60s slack = 2100s. The declared 33m WAS the
// floor exactly, with zero headroom, so adding the kit-pivot budget in #1136
// pushed the floor past it and the guard went red — as designed. Raised to
// 35m rather than shaving the budget, because a finish sitting on its own
// floor cancels healthy runs and a cancellation gets no retry, no error and
// no telemetry (#1069).
//
// Folding the 60-step enrich fan-out into one batched step would take this to
// ~5 boundaries and ~8m — still the largest step-run reduction available in
// the fleet. Deliberately not done here: per-item steps checkpoint completed
// rows, so folding re-runs up to 60 rows of PAID lookups (whois/RDAP/CT/
// AbuseIPDB) on a mid-batch retry under retries: 2. It wants an idempotency
// read-back first. Tracked in BACKLOG.md.
export const cloneWatchEnrichAttribution = inngest.createFunction(
  {
    id: "clone-watch-enrich-attribution",
    name: "Clone-watch: attribution dossier enricher",
    // Raised (#1069): step boundaries queue for the account's 5 Hobby-plan
    // concurrency slots (~30–60s each under contention); the old budget
    // cancelled healthy runs. Finite per ADR-0019; floor guarded by
    // inngestFinishBudgets.test.ts.
    timeouts: { finish: "35m" },
    retries: 2,
    // --- manual-trigger guards (CLAUDE.md: "any cron that also has a
    // manual-trigger must have a throttle AND a same-window cooldown, or
    // stacked manual fires breach per-hour API caps"). ---
    //
    // Deliberately NO explicit cooldown step here, unlike the sibling
    // lifecycle-recheck (50m). The rule exists because stacked manual fires
    // re-burst the same work; that applies to recheck because its worklist is a
    // ROTATING POOL — the same rows are eligible again on the next run, so N
    // stacked fires = N × 50 urlscan submits (the 2026-07-12 100/hour breach).
    //
    // This enricher's worklist is SELF-DRAINING: it selects only rows where
    // attribution IS NULL, and the first thing each run does is fill that in. A
    // second run minutes later finds ~nothing and is a no-op. Stacking fires
    // cannot re-burst work that no longer exists. concurrency 1 additionally
    // serialises any stack, so two fires can't race the same worklist.
    concurrency: { limit: 1 },
    // Structural daily ceiling on starts (the backstop the rule actually asks
    // for). Worst case sits well under every quota: ENRICH_RUN_CAP (60) whois
    // lookups only ever apply to unenriched rows (NRD supplies ~30/day), and
    // KIT_PIVOT_RUN_CAP (10) × 6 = 60 urlscan searches against a 1000/day
    // search quota (6%).
    throttle: { limit: 6, period: "1d" },
  },
  [
    { cron: "30 13 * * *" }, // daily, just after auto-triage (13:00 UTC)
    // Verification/on-demand trigger. The enricher was the only clone-watch
    // stage without one (siblings: urlscan-submit, urlscan-retrieve,
    // lifecycle-recheck, enforcement-execute all have manual triggers), which
    // made every flag activation wait up to 24h for the next cron tick to
    // produce any evidence at all. Payload is ignored.
    { event: "shopfront/clone.enrich-attribution.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "clone-watch-enrich-attribution" },
    async ({ step }) => {
      if (!featureFlags.cloneWatchAttribution) {
        return { skipped: true, reason: "FF_CLONE_WATCH_ATTRIBUTION disabled" };
      }

      const braked = await step.run("check-brake", () =>
        isFeatureBraked(BRAKE),
      );
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const pending = await step.run("select-pending", async () => {
        const sb = createServiceClient();
        if (!sb) return [] as PendingAlert[];
        const since = new Date(
          Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        // Enrich ALL report-eligible NRD clones (was tp_confirmed-only): the
        // Brand Stewardship email now surfaces registrar + abuse contact for
        // every detected clone so brands can action takedowns themselves. Gate
        // on a completed urlscan render (urlscan_scanned_at) so the dossier's
        // hosting block is populated; FP/neutral domains still get enriched
        // because they still appear in the brand's monthly tally.
        const { data, error } = await sb
          .from("shopfront_clone_alerts")
          .select("id, candidate_domain, urlscan_evidence")
          .eq("source", "nrd")
          .not("urlscan_scanned_at", "is", null)
          .is("attribution", null)
          .gte("first_seen_at", since)
          .order("first_seen_at", { ascending: false })
          .limit(ENRICH_RUN_CAP);
        if (error) {
          logger.error("clone-watch enrich: select failed", {
            error: error.message,
          });
          return [] as PendingAlert[];
        }
        return (data ?? []) as PendingAlert[];
      });

      // NO early return on an empty `pending`. This run has THREE independent
      // stages — enrich (worklist: attribution IS NULL), kit-pivots (worklist:
      // likely_phishing AND kit_siblings IS NULL) and the campaign backfill
      // (worklist: attribution IS NOT NULL AND campaign_key IS NULL). Returning
      // here when only the FIRST worklist is empty made the other two unreachable
      // in the enricher's steady state — once it catches up on enrichment (the
      // normal condition), the backfill and kit-pivots silently stopped running
      // forever. Measured 2026-07-17: enrich worklist 0, while 1,085 rows awaited
      // campaign_key and 42 awaited a kit pivot. The empty loop below is a no-op,
      // so each stage now gates on its OWN worklist and nothing else.
      let enriched = 0;
      for (const alert of pending) {
        const ok = await step.run(`enrich-${alert.id}`, async () => {
          const hosting: HostingInfo = {
            ip: alert.urlscan_evidence?.server?.ip ?? null,
            country: alert.urlscan_evidence?.server?.country ?? null,
            asn: alert.urlscan_evidence?.server?.asn ?? null,
          };
          const dossier = await enrichCloneAttribution(
            alert.candidate_domain,
            hosting,
          );
          const sb = createServiceClient();
          if (!sb) return false;
          // Stamp the campaign key in the SAME write (zero extra writes). Sentinel
          // "insufficient" for a too-weak fingerprint so the row still crosses the
          // backfill predicate below and is never re-selected.
          const update: { attribution: typeof dossier; campaign_key?: string } =
            {
              attribution: dossier,
            };
          if (featureFlags.cloneCampaigns) {
            update.campaign_key =
              campaignKeyFromDossier(dossier) ?? "insufficient";
          }
          const { error } = await sb
            .from("shopfront_clone_alerts")
            .update(update)
            .eq("id", alert.id);
          if (error) {
            logger.error("clone-watch enrich: update failed", {
              alertId: alert.id,
              error: error.message,
            });
            return false;
          }
          return true;
        });
        if (ok) enriched += 1;
      }

      // Kit pivots: for confirmed likely_phishing clones, search urlscan for
      // other sites on the same hosting IP (a phishing kit deployed repeatedly)
      // and store attribution.kit_siblings. One batched step (no fan-out). Op-
      // review rule: EVERY completed search writes a block — even zero siblings —
      // so the row crosses the `kit_siblings IS NULL` predicate and is never
      // re-searched; a 429 (quota) writes nothing and aborts the batch, leaving
      // rows eligible tomorrow.
      let kitPivots: KitPivotOutcome = { ...NO_KIT_PIVOTS };
      if (featureFlags.cloneWatchKitPivots && process.env.URLSCAN_API_KEY) {
        kitPivots = await budgetedStep(
          step,
          "kit-pivots",
          KIT_PIVOT_WALL_CLOCK_MS,
          async (budget) => {
            const sb = createServiceClient();
            if (!sb) return { ...NO_KIT_PIVOTS };
            const since = new Date(
              Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
            ).toISOString();
            const { data } = await sb
              .from("shopfront_clone_alerts")
              .select("id, candidate_domain, urlscan_evidence, attribution")
              .eq("urlscan_classification", "likely_phishing")
              .not("attribution", "is", null)
              .is("attribution->kit_siblings", null)
              .gte("first_seen_at", since)
              // Newest first so a backlog of un-pivotable (no-IP) rows can't
              // monopolise the cap and starve fresh rows that DO have an IP.
              .order("first_seen_at", { ascending: false })
              .limit(KIT_PIVOT_RUN_CAP);
            const rows = (data ?? []) as KitPivotRow[];

            // The decision — which rows are written, failed, abandoned to
            // quota, or never reached — lives in runKitPivots so it can be
            // tested by calling it. This step owns only the I/O it injects.
            const outcome = await runKitPivots({
              rows,
              budget,
              search: (ip) => searchURLScan(`page.ip:"${ip}"`, 50),
              write: async (row, block) => {
                const { error } = await sb
                  .from("shopfront_clone_alerts")
                  .update({
                    attribution: {
                      ...(row.attribution ?? {}),
                      kit_siblings: block,
                    },
                  })
                  .eq("id", row.id);
                if (error) {
                  logger.warn("clone-watch enrich: kit-pivot write failed", {
                    alertId: row.id,
                    error: error.message,
                  });
                }
                return { ok: !error };
              },
            });

            if (
              outcome.failed > 0 ||
              outcome.notReachedQuota > 0 ||
              outcome.notReachedBudget > 0
            ) {
              logger.warn("clone-watch enrich: kit-pivot rows left unwritten", {
                attempted: outcome.attempted,
                written: outcome.written,
                failed: outcome.failed,
                notReachedQuota: outcome.notReachedQuota,
                notReachedBudget: outcome.notReachedBudget,
              });
            }
            return outcome;
          },
        );
      }

      // Converging backfill: stamp campaign_key on already-enriched rows that
      // predate this feature. Bounded per run; the "insufficient" sentinel means
      // weak-attribution rows also cross the predicate, so it drains to zero over
      // a few days. One batched step (no per-row fan-out).
      let backfill: WriteOutcome = { ...NO_WRITES };
      if (featureFlags.cloneCampaigns) {
        backfill = await step.run("backfill-campaign-keys", async () => {
          const sb = createServiceClient();
          if (!sb) return { ...NO_WRITES };
          const { data } = await sb
            .from("shopfront_clone_alerts")
            .select("id, attribution")
            .not("attribution", "is", null)
            .is("campaign_key", null)
            .limit(BACKFILL_CAP);
          const rows = (data ?? []) as Array<{
            id: number;
            attribution: DossierShape | null;
          }>;
          // Grouped, not one UPDATE per row. campaignKeyFromDossier is pure and
          // local — there is NO network call in this loop — so every one of the
          // up-to-500 round trips was pure latency inside a held Inngest slot
          // (15-40s at 30-80ms each), on an account whose 5 concurrency slots
          // were measured at 5/5 in use (ADR-0019).
          //
          // Honest about the size of the win: prod on 2026-09-07 has 703 distinct
          // campaign keys across 2,150 keyed rows, so grouping alone is ~3x, not
          // the 500x a single bulk statement would give. The remaining reduction
          // comes from running the groups with bounded parallelism. A one-shot
          // `UPDATE ... FROM unnest(ids, keys)` RPC would beat both, but it needs
          // a migration and the worklist is currently EMPTY (0 rows needing
          // backfill), so it is not worth one yet.
          const byKey = groupBy(
            rows,
            (r) => campaignKeyFromDossier(r.attribution) ?? "insufficient",
          );

          let n = 0;
          let failures = 0;
          await mapWithConcurrency(
            [...byKey.entries()],
            DB_WRITE_CONCURRENCY,
            async ([key, group]) => {
              const { error } = await sb
                .from("shopfront_clone_alerts")
                .update({ campaign_key: key })
                .in(
                  "id",
                  group.map((r) => r.id),
                );
              if (error) {
                // Previously `if (!error) n += 1;` — a failed update was neither
                // logged nor counted, so `backfilled` under-reported silently and
                // the rows stayed in the worklist with nothing to say why.
                logger.warn(
                  "clone-watch enrich: campaign_key backfill failed",
                  {
                    campaignKey: key,
                    rows: group.length,
                    error: error.message,
                  },
                );
                failures += group.length;
                return;
              }
              n += group.length;
            },
          );

          if (failures > 0) {
            logger.warn(
              "clone-watch enrich: campaign_key rows left unwritten",
              {
                failures,
                attempted: rows.length,
              },
            );
          }
          return {
            attempted: rows.length,
            written: n,
            failed: failures,
            deadlineHit: false,
          };
        });
      }

      logger.info("clone-watch enrich: complete", {
        candidates: pending.length,
        enriched,
        backfilled: backfill.written,
        backfillFailed: backfill.failed,
        kitPivoted: kitPivots.written,
        kitPivotFailed: kitPivots.failed,
        kitPivotAttempted: kitPivots.attempted,
        // The gap, in the shape a consumer reads rather than only in a log
        // line. attempted - written - failed - these two = 0.
        kitPivotNotReachedQuota: kitPivots.notReachedQuota,
        kitPivotNotReachedBudget: kitPivots.notReachedBudget,
      });
      return {
        ok: true,
        candidates: pending.length,
        enriched,
        backfilled: backfill.written,
        backfillFailed: backfill.failed,
        kitPivoted: kitPivots.written,
        kitPivotFailed: kitPivots.failed,
        kitPivotAttempted: kitPivots.attempted,
        kitPivotNotReachedQuota: kitPivots.notReachedQuota,
        kitPivotNotReachedBudget: kitPivots.notReachedBudget,
      };
    },
  ),
);

/** Derive the campaign-fingerprint inputs from a stored/fresh attribution
 *  dossier. Tolerant of partial dossiers (returns null → caller stamps the
 *  "insufficient" sentinel). */
type DossierShape = {
  whois?: { registrar?: string | null; nameServers?: string[] | null } | null;
  ct?: { issuer?: string | null } | null;
  hosting?: { asn?: string | null } | null;
};
function campaignKeyFromDossier(d: DossierShape | null): string | null {
  if (!d) return null;
  return computeCampaignKey({
    registrar: d.whois?.registrar ?? null,
    nameServers: d.whois?.nameServers ?? null,
    asn: d.hosting?.asn ?? null,
    ctIssuer: d.ct?.issuer ?? null,
  });
}
