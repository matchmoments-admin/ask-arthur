// ACNC charity embeddings — backfill + delta job.
//
// Writes to `acnc_charity_embeddings` (1:1 sibling of acnc_charities,
// added in migration v121 — see CLAUDE.md "Never Do" item #5 + 2026-05-09
// incident: HNSW on a write-frequent parent burns Disk-IO budget every
// daily scraper UPDATE). The parent column acnc_charities.name_mission_embedding
// is being deprecated (will be dropped in a follow-up v122 migration after
// this cutover is verified). DO NOT write to the parent column from this
// function — every new embedding goes to the sibling.
//
// Two trigger paths:
//   1. Cron: daily at 04:00 UTC. Handles deltas — the ACNC scraper runs
//      earlier in the day, so by 04:00 any newly-added charities are
//      ready to embed. Daily delta is typically <50 rows.
//   2. Event: acnc.charity-embed.backfill.v1 — manual trigger for the
//      initial 63k-row backfill. Operator fires this ~13 times (each run
//      embeds up to 5000 rows = ~25 batches × 200) until the sibling
//      table is fully populated. Cost: ~$0.11 total at voyage-3.5 generic.
//
// Embedding text: charity_legal_name + other_names joined with " | ". We
// deliberately exclude purposes/beneficiaries — they're similar across
// genuinely-distinct charities ("support cancer patients" appears on every
// cancer charity) and dilute the name-discrimination signal which is what
// the typosquat detector uses.
//
// Discovery: the `get_acnc_charities_missing_embedding(p_limit)` SQL helper
// (v121) returns live charities that don't yet have a sibling row. Avoids
// loading the full table and filtering in JS.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { vectorToPgString } from "@askarthur/utils/pgvector";

import { inngest } from "./client";
import { spanningBudget } from "./step-budget";
import { withAxiomLogging } from "./with-axiom-logging";
import { embed } from "../embeddings";
import { isFeatureBraked } from "../cost-log";

// Tuneable per-run limits. 200 rows/batch is well under Voyage's 1000-input
// per-call limit but keeps a single batch under ~6k tokens (well below the
// 32k context). 25 batches per invocation = 5000 rows/run; the operator
// runs the manual event ~13 times to backfill 63k.
const BATCH_SIZE = 200;
const MAX_BATCHES_PER_RUN = 25;

/**
 * Wall-clock budget for the whole batch loop, in milliseconds.
 *
 * SPANNING, not in-step: the loop awaits `step.run` per batch, so it crosses
 * step boundaries and its clock must be `event.ts` — a Date.now() taken in the
 * handler body is reset by every replay and the guard could never fire
 * (#1124). See ./step-budget.ts for the two bounds.
 *
 * WHY IT MATTERS HERE. The loop is capped at MAX_BATCHES_PER_RUN, and it exits
 * as soon as a batch comes back short — so on a drained worklist a run costs
 * two or three step boundaries and this budget never fires. The cap only binds
 * during a real backfill, and there it is a COUNT with no time bound at all:
 * the run could hold one of the account's five slots for as long as the
 * batches took (ADR-0019). This makes the run's cost bounded in the unit that
 * is actually scarce.
 *
 * Stopping early is safe because the worklist is self-healing — an unembedded
 * row is selected again by the next run, and the cron is daily.
 */
const BACKFILL_WALL_CLOCK_MS = 600_000;

export const ACNC_CHARITY_EMBED_BACKFILL_EVENT =
  "acnc.charity-embed.backfill.v1" as const;

interface CharityRowForEmbed {
  abn: string;
  charity_legal_name: string;
  other_names: string[] | null;
}

function buildEmbedText(row: CharityRowForEmbed): string {
  const parts = [row.charity_legal_name];
  if (row.other_names && row.other_names.length > 0) {
    parts.push(
      row.other_names.filter((n) => n && n.trim().length > 0).join(" | "),
    );
  }
  // Hard cap the composite text at ~512 chars (~ 100 tokens) to avoid edge
  // cases where a charity has dozens of trading-name variants and the
  // embedded text drifts from "name signal" to "list of past names".
  return parts.join("\n").slice(0, 512);
}

async function logCost(args: {
  estimatedCostUsd: number;
  totalTokens: number;
  provider: string;
  modelId: string;
  rowsEmbedded: number;
}) {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from("cost_telemetry").insert({
    feature: "charity-check-embed",
    provider: args.provider,
    operation: "embeddings.create",
    units: args.totalTokens,
    estimated_cost_usd: args.estimatedCostUsd,
    metadata: {
      model: args.modelId,
      total_tokens: args.totalTokens,
      rows_embedded: args.rowsEmbedded,
    },
  });
}

export const acncCharityBackfillEmbed = inngest.createFunction(
  {
    id: "acnc-charity-backfill-embed",
    name: "ACNC: Backfill / delta-embed sibling table",
    retries: 2,
    // One at a time — multiple concurrent runs would race on the same
    // NULL rows. Inngest handles the lock.
    concurrency: { limit: 1 },
    // ADR-0019's circuit breaker, absent until #1135.
    //
    // inngest-finish-budget: 22 boundaries — the STRUCTURAL max is 27 (brake +
    // 25 batches + log-cost), but 27 cannot co-occur with a 600s wall clock:
    // at the 30s-per-boundary queue wait ADR-0019 measures, 600s admits ~20
    // batch boundaries, +2 for the brake and cost steps. Declaring the
    // structural 27 would put the floor at 1470s for a run the budget already
    // bounds at ~660s. 22 x 30s = 660s queue wait; 600s BACKFILL_WALL_CLOCK_MS;
    // 60s slack = 1320s. Declared 23m (1380s).
    //
    // If the queue is idle the run does MORE boundaries and finishes FASTER,
    // so the floor still covers it — the wall clock is bounded by the budget
    // either way. See BACKLOG.md on the floor formula double-counting a
    // spanning budget's queue wait.
    timeouts: { finish: "23m" },
  },
  [
    { cron: "0 4 * * *" }, // daily 04:00 UTC
    { event: ACNC_CHARITY_EMBED_BACKFILL_EVENT },
  ],
  withAxiomLogging(
    { fnId: "acnc-charity-backfill-embed" },
    async ({ event, step }) => {
      // Tier 3 brake gap (enterprise-review P2, closed 2026-08-07): this fn
      // spends on Voyage with logCost but never READ the charity_check brake
      // that cost-daily-check engages — a brake nothing reads is scenery.
      const braked = await step.run("brake-check", () =>
        isFeatureBraked("charity_check"),
      );
      if (braked) {
        return {
          skipped: true,
          reason: "feature_brakes.charity_check engaged",
        };
      }

      let totalEmbedded = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;
      let lastProvider = "";
      let lastModelId = "";

      // Each batch runs as ONE step.run that loads + embeds + writes,
      // returning only a small summary. Splitting into three steps caused
      // InngestErrStateOverflowed at ~13 batches because every step output
      // is persisted as JSON state for replay; each `embed-batch-N` step
      // returned 200 vectors × 1024 floats ≈ 2.5 MB, hitting the 32 MB
      // state cap. Folding into one step keeps the vectors inside the
      // closure; the only output is a 4-field count/tokens summary.
      //
      // Trade-off: lose per-step retry granularity. That's fine — Voyage
      // and Supabase failures are transient and a whole-batch retry is
      // correct (the load-step is idempotent on `IS NULL`, the write-step
      // is per-row keyed and idempotent on the `embedding IS NULL` filter
      // of the next load).
      const budget = spanningBudget({ event }, BACKFILL_WALL_CLOCK_MS, logger);

      let stoppedForTime = false;
      for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_RUN; batchIdx++) {
        if (budget.expired()) {
          // Leftovers drain on the next run rather than the whole run being
          // cancelled mid-loop — a cancellation gets no retry, no error and no
          // telemetry (#1069).
          stoppedForTime = true;
          logger.warn("acnc-charity-backfill-embed: wall-clock break", {
            batchesDone: batchIdx,
            batchCap: MAX_BATCHES_PER_RUN,
          });
          break;
        }
        const summary = await step.run(`batch-${batchIdx}`, async () => {
          const supabase = createServiceClient();
          if (!supabase) throw new Error("Supabase service client unavailable");

          // v121: load via RPC that excludes charities already in the sibling
          // embeddings table. Avoids the previous IS NULL filter on the
          // parent column (which is being deprecated) and naturally excludes
          // soft-deleted (is_delisted=true) charities.
          const { data, error: loadErr } = await supabase.rpc(
            "get_acnc_charities_missing_embedding",
            { p_limit: BATCH_SIZE },
          );

          if (loadErr) {
            throw new Error(
              `batch-${batchIdx} load failed: ${loadErr.message}`,
            );
          }
          const rows = (data ?? []) as CharityRowForEmbed[];
          if (rows.length === 0) {
            return {
              written: 0,
              totalTokens: 0,
              estimatedCostUsd: 0,
              provider: "",
              modelId: "",
              rowsRequested: 0,
            };
          }

          const texts = rows.map(buildEmbedText);
          const result = await embed(texts, { domain: "generic" });

          if (result.vectors.length !== rows.length) {
            throw new Error(
              `batch-${batchIdx} embed count mismatch: ${result.vectors.length} vectors for ${rows.length} rows`,
            );
          }

          // Write to the sibling table in SMALL upsert statements. A single
          // 200-row statement timed out in prod on 2026-08-06 (Inngest run
          // 01KZB51PR9P60V6EZZPJN4TYQT): the May backfill loaded 63k rows
          // BEFORE v121 built idx_acnc_charity_embeddings_hnsw, but now every
          // INSERT pays HNSW graph construction, and 200 vectors in one
          // statement exceeds the pooler's statement timeout. 25 rows/statement
          // keeps each write well under it; ON CONFLICT (charity_abn) DO
          // UPDATE keeps chunk retries idempotent after a partial write.
          const upsertRows = rows.map((row, i) => ({
            charity_abn: row.abn,
            embedding: vectorToPgString(result.vectors[i]),
            model: result.modelId,
            embedded_at: new Date().toISOString(),
          }));
          const WRITE_CHUNK = 25;
          let written = 0;
          for (let off = 0; off < upsertRows.length; off += WRITE_CHUNK) {
            const chunk = upsertRows.slice(off, off + WRITE_CHUNK);
            const { error: writeErr, count } = await supabase
              .from("acnc_charity_embeddings")
              .upsert(chunk, {
                onConflict: "charity_abn",
                count: "exact",
              });
            if (writeErr) {
              throw new Error(
                `batch-${batchIdx} sibling upsert failed at offset ${off}/${upsertRows.length}: ${writeErr.message}`,
              );
            }
            written += count ?? chunk.length;
          }

          return {
            written,
            totalTokens: result.totalTokens,
            estimatedCostUsd: result.estimatedCostUsd,
            provider: result.provider,
            modelId: result.modelId,
            rowsRequested: rows.length,
          };
        });

        if (summary.rowsRequested === 0) break;

        totalEmbedded += summary.written;
        totalTokens += summary.totalTokens;
        totalCostUsd += summary.estimatedCostUsd;
        if (summary.provider) lastProvider = summary.provider;
        if (summary.modelId) lastModelId = summary.modelId;

        // Last batch was partial — no more rows to embed.
        if (summary.rowsRequested < BATCH_SIZE) break;
      }

      if (totalEmbedded > 0) {
        await step.run("log-cost", () =>
          logCost({
            estimatedCostUsd: totalCostUsd,
            totalTokens: totalTokens,
            provider: lastProvider,
            modelId: lastModelId,
            rowsEmbedded: totalEmbedded,
          }),
        );
      }

      logger.info("acnc-charity-backfill-embed: complete", {
        rowsEmbedded: totalEmbedded,
        totalTokens,
        estimatedCostUsd: totalCostUsd.toFixed(6),
        modelId: lastModelId,
        stoppedForTime,
        budgetDegraded: budget.degraded,
      });

      return {
        rowsEmbedded: totalEmbedded,
        totalTokens,
        estimatedCostUsd: totalCostUsd,
        modelId: lastModelId,
        // A partial run must not read as a small one: the budget stopped it
        // and the remainder is waiting in the self-healing worklist.
        stoppedForTime,
        budgetDegraded: budget.degraded,
      };
    },
  ),
);
