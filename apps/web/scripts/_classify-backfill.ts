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
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { runSpendingBackfill } from "@askarthur/scam-engine/backfill";
import {
  classifyPosts,
  PROMPT_VERSION_FOR_BACKFILL,
  type ClassifyPostInput,
} from "@askarthur/scam-engine/inngest/reddit-intel-daily";

const COUNT = Number(process.argv[2] ?? 25);
const DRY = process.argv.includes("--dry");
const BATCH = 25;

/**
 * Below this, a post has nothing to classify.
 *
 * 239 of the 1,860 unclassified posts carry under 120 characters of body —
 * link-only submissions and one-line questions. They come back as
 * low-confidence `other` or `informational`, which then suppresses at the take
 * stage anyway, so the money buys a row that no surface renders and a vote in
 * the theme clustering that is worse than no vote. Measured cost of skipping
 * them: US$1.10 not spent.
 */
const MIN_BODY_CHARS = 120;

/** Measured over the last 30 days of real classify calls. */
const USD_PER_POST = 0.004597;

async function main() {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("no supabase service client");


  // Both reads paginate. `.limit(500)` used to cap the candidate pool here, so
  // asking for 1,000 could only ever see the newest 500 posts and would report
  // a total that looked like the whole job. PostgREST also caps any single read
  // at 1,000 rows regardless of what you ask for, and there are 4,300+ rows on
  // the classified side alone.
  const SELECT =
    "id, title, description, body_md, url, country_code, upvotes, source_created_at";

  const { rows: candidates, error } = await fetchAllRows<
    Record<string, unknown>
  >(
    (from, to) =>
      supabase
        .from("feed_items")
        .select(SELECT)
        .eq("source", "reddit")
        .eq("published", true)
        .order("id", { ascending: false })
        .range(from, to),
    { maxRows: 50_000 },
  );
  if (error) throw new Error(error.message);

  // Every already-classified id, not just the ones that intersect this page.
  const { rows: existing, error: exErr } = await fetchAllRows<{
    feed_item_id: number;
  }>(
    (from, to) =>
      supabase
        .from("reddit_post_intel")
        .select("feed_item_id")
        .order("feed_item_id", { ascending: true })
        .range(from, to),
    { maxRows: 200_000 },
  );
  if (exErr) throw new Error(exErr.message);
  const done = new Set(existing.map((e) => e.feed_item_id));

  const unclassified = candidates.filter((c) => !done.has(c.id as number));
  const thin = unclassified.filter(
    (c) =>
      ((c.body_md as string | null) ?? (c.description as string | null) ?? "")
        .length < MIN_BODY_CHARS,
  ).length;

  const todo = unclassified
    .filter(
      (c) =>
        ((c.body_md as string | null) ?? (c.description as string | null) ?? "")
          .length >= MIN_BODY_CHARS,
    )
    .slice(0, COUNT) as unknown as ClassifyPostInput[];

  console.log(
    `${unclassified.length} unclassified · ${thin} too thin to classify (under ${MIN_BODY_CHARS} chars) · ${todo.length} to process`,
  );
  if (todo.length === 0) return;

  // The brake, the dry gate, per-batch isolation, cost logging and the
  // partial-run exit all live in runSpendingBackfill now. This script and
  // _take-backfill.ts had four of those five wrong, independently, weeks
  // apart — which is what a missing Module looks like from the outside.
  // What is left here is the part that is genuinely about classification.
  await runSpendingBackfill<ClassifyPostInput>({
    label: "classify_backfill_script",
    brakeFeature: "reddit_intel",
    costFeature: "reddit-intel-classify",
    provider: "anthropic",
    operation: "messages.create",
    usdPerItem: USD_PER_POST,
    items: todo,
    batchSize: BATCH,
    dryRun: DRY,
    runBatch: async (slice) => {
      const res = await classifyPosts(slice);

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

      // ignoreDuplicates matches the Inngest step: UNIQUE(feed_item_id) is the
      // idempotency key, and a concurrent classify run must not error here.
      const { error: upErr } = await supabase
        .from("reddit_post_intel")
        .upsert(rows, { onConflict: "feed_item_id", ignoreDuplicates: true });
      if (upErr) throw new Error(`upsert: ${upErr.message}`);

      return {
        costUsd: res.estimatedCostUsd,
        units: res.usage.inputTokens + res.usage.outputTokens,
        // `post_count` is the key the Inngest step uses. This script wrote
        // `posts`, so backfill spend was invisible to any cost query keyed on
        // the cron's shape.
        metadata: { model: res.modelId, post_count: slice.length },
        summary: `${rows.length} classified${res.truncated ? " · TRUNCATED" : ""}`,
      };
    },
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
