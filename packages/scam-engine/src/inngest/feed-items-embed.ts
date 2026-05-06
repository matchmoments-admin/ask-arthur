// Embed news-style feed_items (scamwatch_alert / acsc / asic_investor) with
// Voyage 3 (1024d) — same model + fallback path as Reddit intel and
// scam_reports. Drops the embedded vector into feed_items.embedding so the
// hybrid retrieval RPCs can fold regulator narratives into search results.
//
// Cron-triggered rather than event-triggered because the producer
// (Python scrapers in pipeline/scrapers/) writes via psycopg and has no
// Inngest client. A 30-min poll is fast enough for the 3h scraper cadence
// and cheap — the get_unembedded_narrative_feed_items RPC is index-bounded
// to a few hundred rows max.
//
// Idempotency: the RPC only returns rows where embedding IS NULL; once the
// UPDATE writes a vector, subsequent polls ignore the row.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import { embed } from "../embeddings";

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

const BATCH_LIMIT = 40;

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

function vectorToPgString(vec: number[]): string {
  return "[" + vec.join(",") + "]";
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
    name: "News Intel: Embed narrative feed_items",
    retries: 3,
  },
  { cron: "*/30 * * * *" },
  async ({ step }) => {
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

    const result = await step.run("embed", async () => {
      const texts = rows.map(buildEmbedText);
      return embed(texts);
    });

    if (result.vectors.length !== rows.length) {
      throw new Error(
        `embedding count mismatch: ${result.vectors.length} vs ${rows.length}`,
      );
    }

    const written = await step.run("write-embeddings", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      let count = 0;
      for (let i = 0; i < rows.length; i++) {
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
        count++;
      }
      return count;
    });

    await step.run("log-cost", () =>
      logCost({
        estimatedCostUsd: result.estimatedCostUsd,
        totalTokens: result.totalTokens,
        provider: result.provider,
        modelId: result.modelId,
        itemCount: written,
      }),
    );

    logger.info("feed-items-embed: complete", {
      candidates: rows.length,
      embedded: written,
      provider: result.provider,
      tokens: result.totalTokens,
      cost: result.estimatedCostUsd.toFixed(6),
    });

    return {
      candidates: rows.length,
      embedded: written,
      provider: result.provider,
      estimatedCostUsd: result.estimatedCostUsd,
    };
  },
);
