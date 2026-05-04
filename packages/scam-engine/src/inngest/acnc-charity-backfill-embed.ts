// ACNC charity embeddings — backfill + delta job.
//
// Embeds acnc_charities.name_mission_embedding for any row where it's NULL
// (initial 63k-row backfill, plus daily deltas as the ACNC scraper adds new
// rows). Idempotent: only touches rows with embedding IS NULL.
//
// Two trigger paths:
//   1. Cron: daily at 04:00 UTC. Handles deltas — the ACNC scraper runs
//      earlier in the day, so by 04:00 any newly-added charities are
//      ready to embed. Daily delta is typically <50 rows.
//   2. Event: acnc.charity-embed.backfill.v1 — manual trigger for the
//      initial 63k-row backfill. Operator fires this ~13 times (each run
//      embeds up to 5000 rows = ~25 batches × 200) until count(NULL)
//      reaches zero. Cost: ~$0.11 total at voyage-3.5 generic.
//
// Embedding text: charity_legal_name + other_names joined with " | ". We
// deliberately exclude purposes/beneficiaries — they're similar across
// genuinely-distinct charities ("support cancer patients" appears on every
// cancer charity) and dilute the name-discrimination signal which is what
// the typosquat detector uses.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import { embed } from "../embeddings";

// Tuneable per-run limits. 200 rows/batch is well under Voyage's 1000-input
// per-call limit but keeps a single batch under ~6k tokens (well below the
// 32k context). 25 batches per invocation = 5000 rows/run; the operator
// runs the manual event ~13 times to backfill 63k.
const BATCH_SIZE = 200;
const MAX_BATCHES_PER_RUN = 25;

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
    parts.push(row.other_names.filter((n) => n && n.trim().length > 0).join(" | "));
  }
  // Hard cap the composite text at ~512 chars (~ 100 tokens) to avoid edge
  // cases where a charity has dozens of trading-name variants and the
  // embedded text drifts from "name signal" to "list of past names".
  return parts.join("\n").slice(0, 512);
}

function vectorToPgString(vec: number[]): string {
  return "[" + vec.join(",") + "]";
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
    name: "ACNC: Backfill / delta-embed name_mission_embedding",
    retries: 2,
    // One at a time — multiple concurrent runs would race on the same
    // NULL rows. Inngest handles the lock.
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 4 * * *" }, // daily 04:00 UTC
    { event: ACNC_CHARITY_EMBED_BACKFILL_EVENT },
  ],
  async ({ step }) => {
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
    for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_RUN; batchIdx++) {
      const summary = await step.run(`batch-${batchIdx}`, async () => {
        const supabase = createServiceClient();
        if (!supabase) throw new Error("Supabase service client unavailable");

        const { data, error: loadErr } = await supabase
          .from("acnc_charities")
          .select("abn, charity_legal_name, other_names")
          .is("name_mission_embedding", null)
          .order("abn", { ascending: true })
          .limit(BATCH_SIZE);

        if (loadErr) {
          throw new Error(`batch-${batchIdx} load failed: ${loadErr.message}`);
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

        let written = 0;
        for (let i = 0; i < rows.length; i++) {
          const { error: writeErr } = await supabase
            .from("acnc_charities")
            .update({
              name_mission_embedding: vectorToPgString(result.vectors[i]),
              embedding_model_version: result.modelId,
            })
            .eq("abn", rows[i].abn);
          if (writeErr) {
            logger.warn("acnc-charity-backfill: row update failed", {
              abn: rows[i].abn,
              error: writeErr.message,
            });
            continue;
          }
          written++;
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
    });

    return {
      rowsEmbedded: totalEmbedded,
      totalTokens,
      estimatedCostUsd: totalCostUsd,
      modelId: lastModelId,
    };
  },
);
