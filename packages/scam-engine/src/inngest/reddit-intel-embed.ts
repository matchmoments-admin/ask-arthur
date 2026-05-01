// Reddit Intelligence — embedding pass.
//
// Triggered by reddit.intel.summarised.v1 (fired by reddit-intel-daily after
// classification). For each newly-classified post in the cohort, computes a
// 1024-dim Voyage 3 (or OpenAI fallback) embedding from a composite of the
// narrative summary + intent label + brand list, writes it back to
// reddit_post_intel.embedding, then emits reddit.intel.embedded.v1 for the
// cluster function to consume.
//
// Why a separate function instead of inlining into the daily classifier:
// the Sonnet call costs ~$0.20/batch and embeddings cost ~$0.001/batch.
// If embedding fails (Voyage outage, OpenAI rate-limit), retrying the whole
// daily function would re-bill the Sonnet call. Splitting them lets
// embedding fail and retry independently.
//
// Idempotency: the function only updates rows with embedding IS NULL, so
// retries are safe — once a row is embedded, subsequent runs ignore it.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

import { inngest } from "./client";
import {
  REDDIT_INTEL_SUMMARISED_EVENT,
  REDDIT_INTEL_EMBEDDED_EVENT,
  parseRedditIntelSummarisedData,
} from "./events";
import { embed } from "../embeddings";

interface IntelRowForEmbed {
  id: string;
  intent_label: string;
  brands_impersonated: string[] | null;
  narrative_summary: string | null;
  modus_operandi: string | null;
}

// Compose the text we embed. Putting the structured signals inside the text
// lets the embedding capture both the "what" (intent + brands) and the
// "how" (narrative + modus operandi). Without the structured prefix, posts
// that share narratives but differ in intent (e.g. romance vs employment
// scams that both involve "I sent them money via gift cards") cluster
// incorrectly.
function buildEmbedText(row: IntelRowForEmbed): string {
  const parts: string[] = [`category:${row.intent_label}`];
  if (row.brands_impersonated && row.brands_impersonated.length > 0) {
    parts.push(`brands:${row.brands_impersonated.join(",")}`);
  }
  if (row.modus_operandi) {
    parts.push(`tactic:${row.modus_operandi}`);
  }
  if (row.narrative_summary) {
    parts.push(row.narrative_summary);
  }
  return parts.join(" | ");
}

// pgvector wire format. supabase-js serialises a JS array as a JSON array
// which PostgREST then sends as Postgres array syntax `{...}` — wrong for
// vector columns. The unambiguous-everywhere format is the bracketed text
// `[1,2,3]` which pgvector accepts on insert / update.
function vectorToPgString(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

async function logCost(args: {
  estimatedCostUsd: number;
  totalTokens: number;
  provider: string;
  modelId: string;
  cohortDate: string;
  postCount: number;
}) {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from("cost_telemetry").insert({
    feature: "reddit-intel-embed",
    provider: args.provider,
    operation: "embeddings.create",
    units: args.totalTokens,
    estimated_cost_usd: args.estimatedCostUsd,
    metadata: {
      model: args.modelId,
      total_tokens: args.totalTokens,
      cohort_date: args.cohortDate,
      post_count: args.postCount,
    },
  });
}

export const redditIntelEmbed = inngest.createFunction(
  {
    id: "reddit-intel-embed",
    name: "Reddit Intel: Embed newly classified posts",
    retries: 3,
  },
  { event: REDDIT_INTEL_SUMMARISED_EVENT },
  async ({ event, step }) => {
    if (!featureFlags.redditIntelIngest) {
      return { skipped: true, reason: "redditIntelIngest flag off" };
    }

    const data = await step.run("parse-event", () =>
      parseRedditIntelSummarisedData(event.data),
    );

    // ── Step 1: load classified rows in this cohort that lack embeddings ──
    const rows = await step.run("load-unembedded", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      // We don't have a cohort_date column on reddit_post_intel — joining
      // back via feed_items would be slow. Instead, key on processed_at
      // window: anything processed in the 24h around the cohort date.
      const cohortStart = new Date(`${data.cohortDate}T00:00:00Z`).toISOString();
      const cohortEnd = new Date(
        new Date(cohortStart).getTime() + 24 * 3600 * 1000,
      ).toISOString();

      const { data: rows, error } = await supabase
        .from("reddit_post_intel")
        .select(
          "id, intent_label, brands_impersonated, narrative_summary, modus_operandi",
        )
        .gte("processed_at", cohortStart)
        .lt("processed_at", cohortEnd)
        .is("embedding", null)
        .limit(500);

      if (error) {
        throw new Error(`load-unembedded failed: ${error.message}`);
      }
      return (rows ?? []) as IntelRowForEmbed[];
    });

    if (rows.length === 0) {
      logger.info("reddit-intel-embed: nothing to embed", {
        cohortDate: data.cohortDate,
      });
      return { skipped: true, reason: "all_already_embedded" };
    }

    // ── Step 2: call Voyage / OpenAI ─────────────────────────────────────
    const result = await step.run("embed", async () => {
      const texts = rows.map(buildEmbedText);
      return embed(texts);
    });

    if (result.vectors.length !== rows.length) {
      throw new Error(
        `embedding count mismatch: ${result.vectors.length} vectors for ${rows.length} rows`,
      );
    }

    // ── Step 3: write embeddings back ────────────────────────────────────
    const written = await step.run("write-embeddings", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      // Per-row updates. supabase-js doesn't support correlated CASE/WHEN
      // batch updates, but at ~40 rows/batch this is sub-second.
      let count = 0;
      for (let i = 0; i < rows.length; i++) {
        const vec = vectorToPgString(result.vectors[i]);
        const { error } = await supabase
          .from("reddit_post_intel")
          .update({ embedding: vec })
          .eq("id", rows[i].id);
        if (error) {
          // Log and continue — a single-row failure shouldn't sink the batch.
          // The next embed pass will retry this row (still IS NULL).
          logger.warn("reddit-intel-embed: row update failed", {
            id: rows[i].id,
            error: error.message,
          });
          continue;
        }
        count++;
      }
      return count;
    });

    // ── Step 4: cost telemetry + downstream event ────────────────────────
    await step.run("log-cost", () =>
      logCost({
        estimatedCostUsd: result.estimatedCostUsd,
        totalTokens: result.totalTokens,
        provider: result.provider,
        modelId: result.modelId,
        cohortDate: data.cohortDate,
        postCount: written,
      }),
    );

    await step.run("emit-embedded", () =>
      inngest.send({
        name: REDDIT_INTEL_EMBEDDED_EVENT,
        data: {
          cohortDate: data.cohortDate,
          postsEmbedded: written,
          embeddingProvider: result.provider,
          modelId: result.modelId,
        },
      }),
    );

    logger.info("reddit-intel-embed: complete", {
      cohortDate: data.cohortDate,
      candidates: rows.length,
      embedded: written,
      provider: result.provider,
      totalTokens: result.totalTokens,
      estimatedCostUsd: result.estimatedCostUsd.toFixed(6),
    });

    return {
      cohortDate: data.cohortDate,
      embedded: written,
      provider: result.provider,
      estimatedCostUsd: result.estimatedCostUsd,
    };
  },
);
