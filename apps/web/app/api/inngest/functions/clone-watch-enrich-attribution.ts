import { inngest } from "@askarthur/scam-engine/inngest/client";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { isFeatureBrakedOrUnknown } from "@askarthur/scam-engine/cost-log";
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
import {
  ENRICH_CONCURRENCY,
  ENRICH_FLUSH_EVERY,
  ENRICH_MIN_START_INTERVAL_MS,
  runEnrichBatch,
  type EnrichBatchOutcome,
} from "@/lib/clone-watch/enrich-attribution-batch";
import { computeCampaignKey } from "@/lib/clone-watch/campaign-fingerprint";
import { searchURLScan } from "@askarthur/scam-engine/urlscan-search";
import {
  NO_KIT_PIVOTS,
  runKitPivots,
  type KitPivotOutcome,
  type KitPivotRow,
} from "@/lib/clone-watch/kit-pivot";
import { LANES, recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { laneCrons, laneGate } from "@/lib/laneHealth";

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

const BRAKE = LANES["clone-watch-enrich-attribution"].brake;
// Bumped 15 → 60: attribution now feeds the monthly Brand Stewardship email,
// which lists registrar + abuse contact for EVERY detected clone (not just
// operator-confirmed ones), so the enricher must keep pace with the full NRD
// detection volume (~30/day). WHOIS/CT/geo are free-tier ($0); the run is still
// brake-capped + bounded by this cap.
const ENRICH_RUN_CAP = 60;
const RECENT_WINDOW_DAYS = 35; // covers a full prior calendar month for the report
// How long an unscanned lookalike waits for a urlscan render (which brings the
// hosting block) before we enrich it with registrar data alone. urlscan
// submits within a day of detection; three days covers a retry.
const UNSCANNED_GRACE_HOURS = 72;
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

/**
 * In-step wall-clock budget for the enrich batch, in milliseconds.
 *
 * IN-STEP (budgetedStep): the whole batch runs inside ONE step.run, so the
 * bound is the route's 300s maxDuration and the clock starts at step entry.
 * A budget measured from event.ts here would be the #1124/#1141 defect —
 * expired at index 0 whenever the step queued behind the fleet.
 *
 * Sized from the pacing, not guessed: ENRICH_RUN_CAP (60) rows started at
 * least ENRICH_MIN_START_INTERVAL_MS (3s) apart need ~177s, so 200s lets a
 * healthy full run finish. The budget is checked before each row STARTS, so
 * the last row can begin at 200s and run its worst case (~34s — see
 * enrich-attribution-batch.ts) plus the final flush: ~235s, inside 300s. The
 * budget itself sits under budgetedStep's 240s ceiling.
 *
 * Stopping early is safe: an unreached row keeps `attribution IS NULL` and is
 * the OLDEST in tomorrow's oldest-first worklist.
 */
const ENRICH_WALL_CLOCK_MS = 200_000;

interface PendingAlert {
  id: number;
  candidate_domain: string;
  urlscan_evidence: { server?: HostingInfo } | null;
}

// inngest-finish-budget: 5 boundaries — select-pending, enrich-batch
// (budgetedStep), kit-pivots (budgetedStep), backfill-campaign-keys,
// log-outcome. Was 64: the 60 per-alert `enrich-${id}` steps are folded into
// ONE bounded-concurrency step (#1229; #1074 named this the largest per-item
// fan-out in the fleet). budgetedStep's step.run is invisible to the static
// count, so the declaration names all five.
//
// Floor = 5 x 30s queue wait + 320s inline (ENRICH_WALL_CLOCK_MS 200s +
// KIT_PIVOT_WALL_CLOCK_MS 120s) + 60s slack = 530s. 10m = 600s leaves 70s of
// real headroom rather than a budget sitting on its floor (#1138). Was 36m.
//
// The objection that kept this fold out of #1136 — "folding re-runs up to 60
// rows of PAID lookups on a mid-batch retry" — is answered in
// lib/clone-watch/enrich-attribution-batch.ts: every attempt of the step
// first re-reads which rows still have `attribution IS NULL`, and results are
// bulk-written in chunks, so a retry re-pays at most one unflushed chunk.
export const cloneWatchEnrichAttribution = inngest.createFunction(
  {
    id: "clone-watch-enrich-attribution",
    name: "Clone-watch: attribution dossier enricher",
    // 10m (was 36m, #1229): derived above from 5 boundaries + two in-step
    // wall clocks. Finite per ADR-0019; floor guarded by
    // inngestFinishBudgets.test.ts.
    timeouts: { finish: "10m" },
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
    ...laneCrons("clone-watch-enrich-attribution"), // daily 13:30, just after auto-triage
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
      // Flag gate declared once, in LANE_SHAPES (the digest reads the same list).
      const gate = laneGate("clone-watch-enrich-attribution");
      if (!gate.ok) return { skipped: true, reason: gate.reason };

      // The brake read rides inside select-pending (ADR-0019 bookkeeping rule;
      // inngest-slot-budget.md "Step 3"): it was its own `check-brake` step,
      // one Inngest step per run for a single SELECT. Memoised with the
      // worklist, so a replay does not re-read it. Fail-closed as before.
      const selected = await step.run("select-pending", async () => {
        if (await isFeatureBrakedOrUnknown(BRAKE)) {
          return { braked: true as const, rows: [] as PendingAlert[] };
        }
        const sb = createServiceClient();
        if (!sb) return { braked: false as const, rows: [] as PendingAlert[] };
        const since = new Date(
          Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        // Enrich ALL report-eligible NRD clones (was tp_confirmed-only): the
        // Brand Stewardship email now surfaces registrar + abuse contact for
        // every detected clone so brands can action takedowns themselves.
        // Prefer a completed urlscan render (urlscan_scanned_at) so the
        // dossier's hosting block is populated; FP/neutral domains still get
        // enriched because they still appear in the brand's monthly tally.
        //
        // ...but NOT only scanned rows. A lookalike that never resolves (the
        // parked/no-DNS squat a bank most wants to hear about early) is never
        // scanned, so the scanned-only gate left it with no registrar forever:
        // prod 2026-09-22, 910 of 2,906 90-day alerts, incl. 19 taken down.
        // RDAP needs no render. After UNSCANNED_GRACE_HOURS we enrich without
        // hosting (null — honestly unknown, since the domain doesn't serve).
        const unscannedCutoff = new Date(
          Date.now() - UNSCANNED_GRACE_HOURS * 60 * 60 * 1000,
        ).toISOString();
        // OLDEST first (#1231; was newest-first). The window is 35 days, and
        // a newest-first worklist held at its cap never reaches the tail:
        // measured 2026-09-26, a 94-row backlog dated 08-22..08-30 was about
        // to age out unenriched, as 598 rows already had over 90 days. At a
        // cap of 60 against ~25/day inflow, oldest-first drains the tail in
        // days and then keeps up, so no row can age out while waiting.
        //
        // The backlog count repeats the worklist's filters (a shared filter
        // seam trips supabase-js's type-level parser — TS2589); keep the two
        // in step.
        const eligibleOr = `urlscan_scanned_at.not.is.null,first_seen_at.lt.${unscannedCutoff}`;
        const [{ data, error }, backlogRes] = await Promise.all([
          sb
            .from("shopfront_clone_alerts")
            .select("id, candidate_domain, urlscan_evidence")
            .eq("source", "nrd")
            .or(eligibleOr)
            .is("attribution", null)
            .gte("first_seen_at", since)
            .order("first_seen_at", { ascending: true })
            .limit(ENRICH_RUN_CAP),
          sb
            .from("shopfront_clone_alerts")
            .select("id", { count: "exact", head: true })
            .eq("source", "nrd")
            .or(eligibleOr)
            .is("attribution", null)
            .gte("first_seen_at", since),
        ]);
        if (error) {
          logger.error("clone-watch enrich: select failed", {
            error: error.message,
          });
          return {
            braked: false as const,
            rows: [] as PendingAlert[],
            backlog: null,
          };
        }
        // A failed head count returns count=null AND error=null (204): null
        // is "unknown", never 0 (head-count-failures-carry-no-error).
        const backlog =
          typeof backlogRes.count === "number" ? backlogRes.count : null;
        return {
          braked: false as const,
          rows: (data ?? []) as PendingAlert[],
          backlog,
        };
      });
      if (selected.braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }
      const pending = selected.rows;

      // NO early return on an empty `pending`. This run has THREE independent
      // stages — enrich (worklist: attribution IS NULL), kit-pivots (worklist:
      // likely_phishing AND kit_siblings IS NULL) and the campaign backfill
      // (worklist: attribution IS NOT NULL AND campaign_key IS NULL). Returning
      // here when only the FIRST worklist is empty made the other two unreachable
      // in the enricher's steady state — once it catches up on enrichment (the
      // normal condition), the backfill and kit-pivots silently stopped running
      // forever. Measured 2026-07-17: enrich worklist 0, while 1,085 rows awaited
      // campaign_key and 42 awaited a kit pivot. An empty worklist skips only the
      // enrich step below, so each stage gates on its OWN worklist and nothing
      // else.
      //
      // ONE step for the whole enrich worklist (#1229; was one `enrich-${id}`
      // step per alert). Not scheduled at all when the worklist is empty —
      // `pending` is memoised, so that skip is replay-stable and a quiet day
      // costs no step. Every counter lives inside the step and comes back as
      // its return value: nothing here is a handler-level accumulator for an
      // Inngest replay to reset.
      const enrich: EnrichBatchOutcome =
        pending.length === 0
          ? { ...NO_ENRICH }
          : await budgetedStep(
              step,
              "enrich-batch",
              ENRICH_WALL_CLOCK_MS,
              async (budget) => {
                const sb = createServiceClient();
                if (!sb) return { ...NO_ENRICH, pending: pending.length };
                const byId = new Map(pending.map((a) => [a.id, a]));
                return runEnrichBatch({
                  rows: pending,
                  budget,
                  concurrency: ENRICH_CONCURRENCY,
                  minStartIntervalMs: ENRICH_MIN_START_INTERVAL_MS,
                  flushEvery: ENRICH_FLUSH_EVERY,
                  // Idempotency read-back: a retry of this step (a Vercel kill
                  // at maxDuration, a throw, retries: 2) re-reads which rows
                  // still need a dossier and skips the rest, so it never
                  // re-pays their lookups. A failed read THROWS — proceeding
                  // blind would re-pay every one of them.
                  readBack: async (ids) => {
                    const { data, error } = await sb
                      .from("shopfront_clone_alerts")
                      .select("id")
                      .in("id", ids)
                      .is("attribution", null);
                    if (error) {
                      throw new Error(
                        `clone-watch enrich: read-back failed: ${error.message}`,
                      );
                    }
                    return new Set(
                      ((data ?? []) as Array<{ id: number }>).map((r) => r.id),
                    );
                  },
                  enrich: async (row) => {
                    const alert = byId.get(row.id)!;
                    const hosting: HostingInfo = {
                      ip: alert.urlscan_evidence?.server?.ip ?? null,
                      country: alert.urlscan_evidence?.server?.country ?? null,
                      asn: alert.urlscan_evidence?.server?.asn ?? null,
                    };
                    const dossier = await enrichCloneAttribution(
                      alert.candidate_domain,
                      hosting,
                    );
                    // Stamp the campaign key in the SAME write (zero extra
                    // writes). Sentinel "insufficient" for a too-weak
                    // fingerprint so the row still crosses the backfill
                    // predicate below and is never re-selected. null leaves
                    // the column alone (flag off), as the old per-row update
                    // did by omitting the key.
                    return {
                      id: alert.id,
                      attribution: dossier,
                      campaign_key: featureFlags.cloneCampaigns
                        ? (campaignKeyFromDossier(dossier) ?? "insufficient")
                        : null,
                    };
                  },
                  // Bulk write (v331): fills only `attribution IS NULL`, so a
                  // chunk that races a retry is a no-op, never an overwrite.
                  flush: async (writes) => {
                    const { data, error } = await sb.rpc(
                      "apply_clone_alert_attributions",
                      { p_rows: writes },
                    );
                    if (error) return { error: error.message };
                    return { written: typeof data === "number" ? data : 0 };
                  },
                  onRowError: (alertId, err) =>
                    logger.error("clone-watch enrich: lookup failed", {
                      alertId,
                      error: err instanceof Error ? err.message : String(err),
                    }),
                  onFlushError: (alertIds, message) =>
                    logger.error("clone-watch enrich: bulk write failed", {
                      alertIds,
                      error: message,
                    }),
                });
              },
            );
      // Worklist rows that now carry a dossier: written by this attempt, or by
      // an earlier attempt of the same step (the read-back's skips). Counting
      // only this attempt's writes would make a retried run read as
      // `pending>0 ∧ enriched=0` — this Lane's silent_zero page.
      const enriched = enrich.written + enrich.alreadyEnriched;
      if (
        enrich.lookupFailed > 0 ||
        enrich.writeFailed > 0 ||
        enrich.notReachedBudget > 0
      ) {
        logger.warn("clone-watch enrich: rows left unenriched", { ...enrich });
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
              search: async (ip, row) => {
                const res = await searchURLScan(`page.ip:"${ip}"`, 50);
                // Per-row attribution: a run reporting `failed: 7` is
                // uninvestigable without the ids and the error kinds.
                if (!res.ok && res.error !== "rate_limited") {
                  logger.warn("clone-watch enrich: kit-pivot search failed", {
                    alertId: row.id,
                    domain: row.candidate_domain,
                    error: res.error,
                  });
                }
                return res;
              },
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
      // One Outcome Row per run, quiet or not (ADR-0025). This Lane wrote no
      // cost_telemetry at all before 2026-09-23, so six silent days
      // (09-11..16) were indistinguishable from "nothing to enrich".
      await step.run("log-outcome", () =>
        recordLaneOutcome("clone-watch-enrich-attribution", enriched, {
          ...(pending.length === 0
            ? { reason: "nothing_pending" as const }
            : {}),
          pending: pending.length,
          enriched,
          // #1229: what the folded batch did with the worklist.
          already_enriched: enrich.alreadyEnriched,
          lookup_failed: enrich.lookupFailed,
          write_failed: enrich.writeFailed,
          not_reached_budget: enrich.notReachedBudget,
          // #1231: the cap and the backlog it leaves (null = count failed).
          cap: ENRICH_RUN_CAP,
          cap_reached: pending.length >= ENRICH_RUN_CAP,
          backlog: "backlog" in selected ? (selected.backlog ?? null) : null,
          backfilled: backfill.written,
          kit_pivoted: kitPivots.written,
        }),
      );
      return {
        ok: true,
        candidates: pending.length,
        enriched,
        enrichLookupFailed: enrich.lookupFailed,
        enrichWriteFailed: enrich.writeFailed,
        enrichNotReachedBudget: enrich.notReachedBudget,
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

const NO_ENRICH: Readonly<EnrichBatchOutcome> = Object.freeze({
  pending: 0,
  alreadyEnriched: 0,
  attempted: 0,
  written: 0,
  lookupFailed: 0,
  writeFailed: 0,
  writeSkipped: 0,
  notReachedBudget: 0,
  deadlineHit: false,
});

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
