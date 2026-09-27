// Embed news-style feed_items (scamwatch_alert / acsc / asic_investor) with
// Voyage 3 (1024d) — same model + fallback path as Reddit intel and
// scam_reports. Drops the embedded vector into feed_items.embedding so the
// hybrid retrieval RPCs can fold regulator narratives into search results.
//
// PARKED 2026-09-27 — event-only, no cron. See the trigger block below for
// the restore condition. The vector this writes has exactly one reader,
// match_feed_items_narrative, reached only through /api/v1/intel/search with
// scope=narratives|all, FF_REGULATOR_INTEL_SEARCH, FF_REDDIT_INTEL_B2B_API
// and a B2B API key — and api_keys holds zero rows (measured 2026-09-27). Six
// runs a day were write-only work on the account's five Inngest slots, and a
// sixth caller on the unpaid Voyage tier's shared 3 RPM ceiling.
//
// It was cron-triggered rather than event-triggered because the producer
// (Python scrapers in pipeline/scrapers/) writes via psycopg and has no
// Inngest client — so while parked, nothing fires it automatically.
//
// Idempotency: the RPC only returns rows where embedding IS NULL; once the
// UPDATE writes a vector, subsequent polls ignore the row.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { vectorToPgString } from "@askarthur/utils/pgvector";

import { inngest } from "./client";
import { embed } from "../embeddings";
import { isFeatureBrakedOrUnknown } from "../cost-log";
import { withAxiomLogging } from "./with-axiom-logging";
import { budgetedStep } from "./step-budget";

interface UnembeddedRow {
  id: number;
  source: string;
  title: string;
  description: string | null;
  body_md: string | null;
  tags: string[] | null;
  impersonated_brand: string | null;
  category: string | null;
}

export const FEED_ITEMS_EMBED_EVENT = "news-intel.feed-items-embed.v1" as const;

const BATCH_LIMIT = 40;
// embed + write + log-cost run inside ONE step (v308/#1156): they were three
// steps, and on the `:00` account-concurrency pileup each boundary costs
// 30–60 s of queue wait, so 4 boundaries cancelled 12 of 48 runs at the 4 m
// finish. The Voyage call is ~2 s and the 40 row writes ~5 s; the budget is
// checked between the embed and the writes, and the writes are idempotent
// (embedding IS NULL re-selects any row a cut-off run missed). In-step: the
// clock starts at step entry. Floor = 2 × 30 s + 90 s + 60 s = 210 s < 4 m.
const EMBED_WALL_CLOCK_MS = 90_000;

function buildEmbedText(row: UnembeddedRow): string {
  const parts: string[] = [`source:${row.source}`];
  if (row.category) parts.push(`category:${row.category}`);
  if (row.impersonated_brand) parts.push(`brand:${row.impersonated_brand}`);
  if (row.tags && row.tags.length > 0) parts.push(`tags:${row.tags.join(",")}`);
  parts.push(row.title);
  if (row.description) parts.push(row.description);
  if (row.body_md) parts.push(row.body_md.slice(0, 4000));
  return parts.join(" | ");
}

async function logCost(args: {
  estimatedCostUsd: number;
  totalTokens: number;
  provider: string;
  modelId: string;
  itemCount: number;
}) {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from("cost_telemetry").insert({
    feature: "news-intel-embed",
    provider: args.provider,
    operation: "embeddings.create",
    units: args.totalTokens,
    estimated_cost_usd: args.estimatedCostUsd,
    metadata: {
      model: args.modelId,
      total_tokens: args.totalTokens,
      item_count: args.itemCount,
    },
  });
}

export const feedItemsEmbed = inngest.createFunction(
  {
    id: "feed-items-embed",
    timeouts: { finish: "4m" },
    name: "News Intel: Embed narrative feed_items",
    retries: 3,
  },
  // PARKED (event-only, no cron) — 2026-09-27. Same shape as the other parked
  // Lanes (apps/web/__tests__/inngestParkedLanes.test.ts enforces it).
  //
  // **Restore `{ cron: "20 */4 * * *" }` when the first B2B API key exists**
  // (`select count(*) from api_keys` > 0) and narratives search is on for it.
  // Nothing is lost while parked: get_unembedded_narrative_feed_items returns
  // every row with embedding IS NULL, so the first run after restore drains
  // the backlog at BATCH_LIMIT per tick. To embed by hand before then, send
  // FEED_ITEMS_EMBED_EVENT. Keep :20 on restore — off the account-concurrency
  // pileup at :00 (v308/#1156).
  { event: FEED_ITEMS_EMBED_EVENT },
  withAxiomLogging({ fnId: "feed-items-embed" }, async ({ step }) => {
    // Cost brake — this is a paid Voyage call. cost-daily-check sets the
    // `news_intel_embed` brake when the day's embed spend exceeds its cap;
    // every peer Voyage consumer (reddit-intel-*) has the same guard. No
    // brake row → runs normally (regression-free).
    if (await isFeatureBrakedOrUnknown("news_intel_embed")) {
      return { skipped: true, reason: "cost_brake_engaged" };
    }

    const rows = await step.run("load-unembedded", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc(
        "get_unembedded_narrative_feed_items",
        { p_limit: BATCH_LIMIT },
      );
      if (error) throw new Error(`rpc failed: ${error.message}`);
      return (data ?? []) as UnembeddedRow[];
    });

    if (rows.length === 0) {
      return { skipped: true, reason: "no_unembedded_rows" };
    }

    const outcome = await budgetedStep(
      step,
      "embed-and-write",
      EMBED_WALL_CLOCK_MS,
      async (budget) => {
        const texts = rows.map(buildEmbedText);
        const result = await embed(texts);
        if (result.vectors.length !== rows.length) {
          throw new Error(
            `embedding count mismatch: ${result.vectors.length} vs ${rows.length}`,
          );
        }

        const supabase = createServiceClient();
        if (!supabase) throw new Error("supabase service client unavailable");
        let written = 0;
        let cutOff = 0;
        for (let i = 0; i < rows.length; i++) {
          if (budget.expired()) {
            // Unwritten rows stay embedding IS NULL and re-select next tick.
            cutOff = rows.length - i;
            break;
          }
          const vec = vectorToPgString(result.vectors[i]);
          const { error } = await supabase
            .from("feed_items")
            .update({
              embedding: vec,
              embedding_model_version: result.modelId,
            })
            .eq("id", rows[i].id);
          if (error) {
            logger.warn("feed-items-embed: row update failed", {
              id: rows[i].id,
              error: error.message,
            });
            continue;
          }
          written++;
        }

        // Cost is bound to this step: the Voyage call has happened whether or
        // not every row was written, so the row is logged here, not later.
        await logCost({
          estimatedCostUsd: result.estimatedCostUsd,
          totalTokens: result.totalTokens,
          provider: result.provider,
          modelId: result.modelId,
          itemCount: written,
        });

        return {
          written,
          cutOff,
          provider: result.provider,
          totalTokens: result.totalTokens,
          estimatedCostUsd: result.estimatedCostUsd,
        };
      },
    );
    const { written, cutOff } = outcome;

    logger.info("feed-items-embed: complete", {
      candidates: rows.length,
      embedded: written,
      cutOff,
      provider: outcome.provider,
      tokens: outcome.totalTokens,
      cost: outcome.estimatedCostUsd.toFixed(6),
    });

    return {
      candidates: rows.length,
      embedded: written,
      cutOff,
      provider: outcome.provider,
      estimatedCostUsd: outcome.estimatedCostUsd,
    };
  }),
);
