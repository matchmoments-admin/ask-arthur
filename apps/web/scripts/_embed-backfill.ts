/**
 * Reddit Intel — local embedding drain.
 *
 *   pnpm --filter @askarthur/web tsx scripts/_embed-backfill.ts [count] [--dry]
 *
 * WHY THIS EXISTS. `reddit-intel-embed` is event-triggered, not scheduled:
 * it fires on REDDIT_INTEL_SUMMARISED_EVENT from the daily classify run. When
 * the corpus backfill made that cohort 500 posts, `embed()` sent all 500 to
 * Voyage in one request, hit the free tier's 10,000-tokens-per-minute
 * ceiling, and 429'd. Inngest retried three times with the same oversized
 * request, exhausted them, and consumed the event.
 *
 * The result is 976 rows with no embedding and therefore no theme, and
 * NOTHING that will pick them up: the event is gone, and re-firing it needs
 * an INNGEST_EVENT_KEY a local operator does not have (it returns 401).
 * Chunking `embed()` stops it happening again; it does not drain what already
 * accumulated. This does.
 *
 * It imports `buildEmbedText` from the Inngest job rather than reimplementing
 * it, so the text embedded here is byte-identical to the text the live path
 * embeds. A second copy would put vectors built from a different string into
 * the same column, where they would cluster against each other while meaning
 * slightly different things — and nothing downstream would ever reveal it.
 *
 * Spend is $0 on the free tier, and it is still logged: the repo convention
 * is that a free-tier call records `units` at `estimatedCostUsd: 0` so volume
 * and ceiling stay visible. That is exactly the number that mattered here.
 */
import "./_load-env-config";

import { createServiceClient } from "@askarthur/supabase/server";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { runSpendingBackfill } from "@askarthur/scam-engine/backfill";
import { embed } from "@askarthur/scam-engine/embeddings";
import {
  buildEmbedText,
  vectorToPgString,
  type IntelRowForEmbed,
} from "@askarthur/scam-engine/inngest/reddit-intel-embed";

const COUNT = Number(process.argv[2] ?? 100);
const DRY = process.argv.includes("--dry");

/**
 * Rows per outer batch. `embed()` chunks further inside this and paces
 * between its own chunks, so this only controls how often progress prints
 * and how much work one failure costs.
 */
const BATCH = 100;

async function main() {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("no supabase service client");

  const { rows, error } = await fetchAllRows<IntelRowForEmbed & { id: string }>(
    (from, to) =>
      supabase
        .from("reddit_post_intel")
        .select(
          "id, intent_label, brands_impersonated, narrative_summary, modus_operandi",
        )
        .is("embedding", null)
        .order("id", { ascending: true })
        .range(from, to),
    { maxRows: COUNT },
  );
  if (error) throw new Error(error.message);

  console.log(`${rows.length} rows have no embedding (asked for ${COUNT})`);

  await runSpendingBackfill<IntelRowForEmbed & { id: string }>({
    label: "embed_backfill_script",
    brakeFeature: "reddit_intel",
    costFeature: "reddit-intel-embed",
    provider: "voyage",
    operation: "embeddings",
    usdPerItem: 0, // free tier — the dry projection is honestly zero
    items: rows,
    batchSize: BATCH,
    dryRun: DRY,
    runBatch: async (slice) => {
      const result = await embed(slice.map(buildEmbedText));

      // The count check the Inngest job also makes. Vectors are matched to
      // rows BY INDEX, so a length mismatch means the mapping is already
      // wrong and writing would attach embeddings to the wrong posts.
      if (result.vectors.length !== slice.length) {
        throw new Error(
          `embedding count mismatch: ${result.vectors.length} vectors for ${slice.length} rows`,
        );
      }

      let written = 0;
      for (let i = 0; i < slice.length; i++) {
        const { error: upErr } = await supabase
          .from("reddit_post_intel")
          .update({
            embedding: vectorToPgString(result.vectors[i]),
            embedding_model_version: result.modelId,
          })
          .eq("id", slice[i].id);
        // A single-row failure must not sink the batch — the row stays
        // `embedding IS NULL` and the next pass picks it up.
        if (upErr) console.error(`  row ${slice[i].id}: ${upErr.message}`);
        else written++;
      }

      return {
        costUsd: result.estimatedCostUsd,
        units: result.totalTokens,
        metadata: {
          model: result.modelId,
          provider: result.provider,
          rows: slice.length,
          written,
        },
        summary: `${written}/${slice.length} embedded`,
      };
    },
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
