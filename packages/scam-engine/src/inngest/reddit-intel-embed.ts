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
import { withAxiomLogging } from "./with-axiom-logging";
import {
  REDDIT_INTEL_SUMMARISED_EVENT,
  REDDIT_INTEL_EMBEDDED_EVENT,
  parseRedditIntelSummarisedData,
} from "./events";
import { embed } from "../embeddings";
import {
  logFunctionError,
  isRedditIntelBraked,
} from "./reddit-intel-error-log";

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

/**
 * Rows per run. Sized by two ceilings, and the tighter one is not the API's.
 *
 *  1. `embed()` now chunks and PACES — roughly 20 texts per provider request
 *     with a pause between chunks, to stay inside Voyage's free tier (3
 *     requests and 10,000 tokens a minute). At 500 rows that is 25 requests
 *     and about 8 minutes of waiting, which alone blows the route's
 *     `maxDuration = 300`.
 *
 *  2. Worse, that wait would be spent INSIDE a step.run, holding an Inngest
 *     concurrency slot the whole time. This project runs on a 5-slot plan,
 *     and long inline steps holding slots is the documented cause of a
 *     previous fleet-wide run-cancellation incident. A step that sleeps for
 *     eight minutes is the exact anti-pattern.
 *
 * 60 rows is three provider requests and two pauses — well under both. It
 * also covers the steady state with headroom: the classifier writes about 40
 * rows a day. A larger backlog drains across runs rather than in one, which
 * is the right trade against starving the rest of the fleet.
 *
 * A bulk drain is an operator job, not this function's: see
 * apps/web/scripts/_embed-backfill.ts, which has no slot to hold.
 */
export const EMBED_ROWS_PER_RUN = 60;

export const redditIntelEmbed = inngest.createFunction(
  {
    id: "reddit-intel-embed",
    name: "Reddit Intel: Embed newly classified posts",
    retries: 3,
  },
  { event: REDDIT_INTEL_SUMMARISED_EVENT },
  withAxiomLogging({ fnId: "reddit-intel-embed" }, async ({ event, step }) => {
    if (!featureFlags.redditIntelIngest) {
      return { skipped: true, reason: "redditIntelIngest flag off" };
    }

    const braked = await step.run("check-cost-brake", isRedditIntelBraked);
    if (braked) {
      return { paused: true, reason: "feature_brakes.reddit_intel is set" };
    }

    // Inline (not a step.run): pure deterministic Zod parse, free to re-run on
    // retry — memoising it as a durable step only cost an Inngest execution.
    const data = parseRedditIntelSummarisedData(event.data);

    // ── Step 1: load rows that lack embeddings ───────────────────────────
    const rows = await step.run("load-unembedded", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      // NOT scoped to this event's cohort, deliberately.
      //
      // It used to be: `processed_at` within the 24h around the cohort date,
      // AND embedding IS NULL. That made the worklist a function of WHICH
      // EVENT fired rather than of which rows need work, and the consequence
      // is that a row missing its one window is orphaned permanently. There
      // is no sweeper; nothing else looks for `embedding IS NULL`.
      //
      // It happened. A corpus backfill made one cohort 500 rows, `embed()`
      // sent all 500 to Voyage in a single request, the free tier's
      // 10,000-tokens-per-minute ceiling returned 429, Inngest exhausted its
      // three retries on the same oversized request, and the event was
      // consumed. 976 rows were left with no embedding and therefore no
      // theme, and no future run would ever have looked at them: the next
      // cohort's window does not contain them.
      //
      // This is the shape CLAUDE.md already documents from the clone-watch
      // v224 incident — a row must be able to cross back over the exact
      // predicate its consuming stage filters on, or the loop is silently
      // inert for it. Here the row never crossed back at all.
      //
      // `embedding IS NULL` IS the worklist. Oldest first, so a backlog
      // drains in the order it accumulated rather than starving behind new
      // arrivals. The event still triggers the run; it no longer narrows it.
      const { data: rows, error } = await supabase
        .from("reddit_post_intel")
        .select(
          "id, intent_label, brands_impersonated, narrative_summary, modus_operandi",
        )
        .is("embedding", null)
        .order("processed_at", { ascending: true })
        .limit(EMBED_ROWS_PER_RUN);

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
    // Most likely failure mode: VOYAGE_API_KEY missing from Vercel env, or
    // Voyage hits a rate-limit / outage. The catch writes the error to
    // cost_telemetry feature='reddit-intel-error' so it's SQL-queryable.
    // Inngest still retries 3x per its function-level config — the catch
    // is purely additive logging.
    const result = await step.run("embed", async () => {
      try {
        const texts = rows.map(buildEmbedText);
        return await embed(texts);
      } catch (err) {
        await logFunctionError({
          step: "embed",
          cohortDate: data.cohortDate,
          postCount: rows.length,
          error: err,
          extra: {
            embedding_provider: process.env.EMBEDDING_PROVIDER ?? "voyage",
          },
        });
        throw err;
      }
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
          .update({
            embedding: vec,
            embedding_model_version: result.modelId,
          })
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
  }),
);
