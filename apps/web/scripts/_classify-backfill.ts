/**
 * Reddit Intel — local classification backfill.
 *
 *   pnpm --filter @askarthur/web tsx scripts/_classify-backfill.ts [count] [--dry]
 *
 * Classifies unclassified Reddit posts WITHOUT dispatching an Inngest event.
 *
 * Why this exists alongside reddit-intel-backfill.ts: that script dispatches
 * `reddit.intel.batch_ready.v1` and needs a valid INNGEST_EVENT_KEY, which a
 * local operator may not have — it returned `401 Event key not found` at the
 * moment the newest 24 posts needed classifying to get the feature live. The
 * Inngest path remains the right one for a large historical backfill, because
 * it runs through production infrastructure with its own retries. This is the
 * direct path for a small, urgent catch-up.
 *
 * It calls classifyPosts — the same function the Inngest step calls — so the
 * prompt, model, schema, token budget and retry behaviour are identical. There
 * is no second opinion about what classification means.
 *
 * Guards: the shared feature_brakes.reddit_intel key, an explicit count, and
 * a --dry mode. Idempotent by the UNIQUE(feed_item_id) on reddit_post_intel:
 * rows already classified are filtered out before any spend.
 */
import "./_load-env-config";

import { createServiceClient } from "@askarthur/supabase/server";
import { isFeatureBraked, logCost } from "@askarthur/scam-engine/cost-log";
import {
  classifyPosts,
  PROMPT_VERSION_FOR_BACKFILL,
  type ClassifyPostInput,
} from "@askarthur/scam-engine/inngest/reddit-intel-daily";

const COUNT = Number(process.argv[2] ?? 25);
const DRY = process.argv.includes("--dry");
const BATCH = 25;

async function main() {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("no supabase service client");

  if (await isFeatureBraked("reddit_intel")) {
    console.log("feature_brakes.reddit_intel engaged — refusing to spend.");
    return;
  }

  const { data: candidates, error } = await supabase
    .from("feed_items")
    .select(
      "id, title, description, body_md, url, country_code, upvotes, source_created_at",
    )
    .eq("source", "reddit")
    .eq("published", true)
    .order("source_created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const { data: existing } = await supabase
    .from("reddit_post_intel")
    .select("feed_item_id")
    .in(
      "feed_item_id",
      (candidates ?? []).map((c) => c.id),
    );
  const done = new Set((existing ?? []).map((e) => e.feed_item_id as number));

  const todo = (candidates ?? [])
    .filter((c) => !done.has(c.id as number))
    .slice(0, COUNT) as unknown as ClassifyPostInput[];

  console.log(
    `${todo.length} unclassified posts to process${DRY ? " — DRY, no writes" : ""}`,
  );
  if (todo.length === 0) return;

  let inserted = 0;
  let spend = 0;

  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    const res = await classifyPosts(slice);
    spend += res.estimatedCostUsd;

    const rows = res.result.perPost.map((e) => ({
      feed_item_id: e.feedItemId,
      intent_label: e.intentLabel,
      confidence: e.confidence,
      modus_operandi: e.modusOperandi ?? null,
      brands_impersonated: e.brandsImpersonated,
      victim_emotion: e.victimEmotion ?? null,
      novelty_signals: e.noveltySignals,
      tactic_tags: e.tacticTags,
      country_hints: e.countryHints,
      narrative_summary: e.narrativeSummary ?? null,
      model_version: res.modelId,
      prompt_version: PROMPT_VERSION_FOR_BACKFILL,
    }));

    if (!DRY) {
      // ignoreDuplicates matches the Inngest step: UNIQUE(feed_item_id) is the
      // idempotency key, and a concurrent classify run must not error here.
      const { error: upErr } = await supabase
        .from("reddit_post_intel")
        .upsert(rows, {
          onConflict: "feed_item_id",
          ignoreDuplicates: true,
        });
      if (upErr) throw new Error(`upsert: ${upErr.message}`);

      await logCost({
        feature: "reddit-intel-classify",
        provider: "anthropic",
        operation: "messages.create",
        units: res.usage.inputTokens + res.usage.outputTokens,
        estimatedCostUsd: res.estimatedCostUsd,
        metadata: {
          model: res.modelId,
          posts: slice.length,
          via: "classify_backfill_script",
        },
      });
    }

    inserted += rows.length;
    console.log(
      `  batch ${i / BATCH + 1}: ${rows.length} classified · US$${res.estimatedCostUsd.toFixed(4)}${res.truncated ? " · TRUNCATED" : ""}`,
    );
  }

  console.log(`\ntotal — ${inserted} classified · US$${spend.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
