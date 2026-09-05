/**
 * Arthur's Take — operator backfill.
 *
 *   pnpm --filter @askarthur/web tsx scripts/_take-backfill.ts [count] [--dry]
 *   pnpm --filter @askarthur/web tsx scripts/_take-backfill.ts [count] --regenerate-truncated
 *
 * Writes takes for rows that already have intelligence. The live Inngest step
 * only covers posts classified in the SAME run (~40/day), so without this the
 * 4,313 existing rows would never get one and the feed would show takes on a
 * thin trickle of new items only.
 *
 * Uses the same module as the live path — generateTakesForPosts — so there is
 * one implementation of what a take is, and this script cannot drift into a
 * second opinion about validation or column mapping.
 *
 * Guards, deliberately the same ones the Inngest step has:
 *   - needsTake() skips any row that already carries a decision, so re-running
 *     is free and cannot double-pay.
 *   - the shared feature_brakes.reddit_intel key is checked first, so a day
 *     that has already tripped the cost cap cannot be topped up by hand.
 *   - batches are bounded and the count is an explicit argument, so the spend
 *     is chosen rather than discovered.
 *
 * At ~US$0.0011 a take, 100 rows is about eleven cents.
 */
import "./_load-env-config";

import { createServiceClient } from "@askarthur/supabase/server";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { runSpendingBackfill } from "@askarthur/scam-engine/backfill";
import {
  generateTakesForPosts,
  needsTake,
  type IntelRowForTake,
} from "@askarthur/scam-engine/reddit-intel/takes";

const COUNT = Number(process.argv[2] ?? 25);
const DRY = process.argv.includes("--dry");

/**
 * Redo takes that were published with a field cut short, rather than rows that
 * have no take at all.
 *
 * The 140-character tell cap clipped 145 tells across 125 of the first 870
 * takes — one in seven carried a visible "…" mid-thought. Raising the cap
 * fixes every take written after it, and nothing at all about the ones already
 * stored, because `needsTake()` correctly refuses to spend twice on a row that
 * already carries a decision. That guard is the right default and stays; this
 * flag is the deliberate exception, and it is narrow on purpose: it selects on
 * the trailing ellipsis, so it can only ever re-pay for rows that visibly show
 * the defect. At ~US$0.001 a take, the 125 rows cost about thirteen cents.
 */
const REGENERATE_TRUNCATED = process.argv.includes("--regenerate-truncated");
const BATCH = 25; // one Claude call per batch; matches the live step's shape

async function main() {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("no supabase service client");


  // One string literal, not a ternary or a join: supabase-js reads the row
  // type off the literal, and anything else degrades it to ParserError.
  const SELECT =
    "id, feed_item_id, intent_label, confidence, modus_operandi, narrative_summary, tactic_tags, brands_impersonated, country_hints, is_emerging, is_scam_report, take_status, take_tells, feed_items(description, body_md, published, source)";

  // BOTH paths paginate, and the second one is the reason to say why.
  //
  // `.limit(COUNT)` looked safe here because COUNT is an argument — but
  // PostgREST caps any single read at 1,000 rows, so `... 3400` would have
  // quietly generated takes for 1,000 rows, printed "1000 rows need a take",
  // and left 2,307 behind with nothing to indicate they had been skipped.
  // __tests__/rowCap.test.ts scans for a LITERAL over 1,000 and cannot see a
  // variable, so this one had no guard at all.
  //
  // The regenerate path has to SCAN every ready take to find the cut ones,
  // because PostgREST cannot express "any element of this text[] ends with …"
  // and so cannot filter it server-side.
  //
  // That scan must be paginated, not a big .limit(). A `.limit(2000)` here
  // silently returned at most 1,000 rows — PostgREST's hard cap — and would
  // have looked correct today, because there are only 870 ready takes. It
  // would have started missing rows the moment the corpus backfill lands and
  // that number passes 1,000, with no error and no short read to notice.
  // `__tests__/rowCap.test.ts` catches exactly this and did.
  const { data, error } = REGENERATE_TRUNCATED
    ? await fetchAllRows<Record<string, unknown>>(
        (from, to) =>
          supabase
            .from("reddit_post_intel")
            .select(SELECT)
            .eq("take_status", "ready")
            .order("id", { ascending: true })
            .range(from, to),
        { maxRows: 50_000 },
      ).then((r) => ({ data: r.rows, error: r.error }))
    : await fetchAllRows<Record<string, unknown>>(
        (from, to) =>
          supabase
            .from("reddit_post_intel")
            .select(SELECT)
            .eq("take_status", "none")
            .order("processed_at", { ascending: false })
            .range(from, to),
        // Newest first, and stop as soon as we have what was asked for — the
        // caller chooses the spend, so there is no reason to read further.
        { maxRows: COUNT },
      ).then((r) => ({ data: r.rows, error: r.error }));

  if (error) throw new Error(error.message);

  const candidates = (data ?? [])
    .filter((r) => {
      const fi = r.feed_items as unknown as {
        published: boolean | null;
        source: string | null;
      } | null;
      // Never spend on a row the public surfaces would not render anyway.
      if (fi?.published !== true || fi?.source !== "reddit") return false;

      if (REGENERATE_TRUNCATED) {
        // The trailing ellipsis is the marker truncateOnWord leaves. Filtered
        // here rather than in the query because PostgREST cannot express
        // "any element of this array ends with" without a stored expression.
        const tells = (r.take_tells as string[] | null) ?? [];
        return tells.some((t) => t.endsWith("…"));
      }
      return needsTake({ takeStatus: r.take_status as string | null });
    })
    .slice(0, COUNT);

  console.log(
    REGENERATE_TRUNCATED
      ? `${candidates.length} published takes carry a field cut short (asked for ${COUNT})`
      : `${candidates.length} rows need a take (asked for ${COUNT})`,
  );

  // The brake, the dry gate, per-batch isolation, cost logging and the
  // partial-run exit all live in runSpendingBackfill now. This script had all
  // five wrong at some point, and so did _classify-backfill.ts, independently.
  // What is left here is the part that is genuinely about takes: which rows to
  // work on, and what to do with a batch of them.
  await runSpendingBackfill<Record<string, unknown>>({
    label: REGENERATE_TRUNCATED ? "regenerate_truncated" : "backfill_script",
    brakeFeature: "reddit_intel",
    costFeature: "reddit-intel-take",
    provider: "anthropic",
    operation: "messages.create",
    usdPerItem: 0.001013, // measured over 730 real takes
    items: candidates,
    batchSize: BATCH,
    dryRun: DRY,
    runBatch: async (slice) => {
      const inputs: IntelRowForTake[] = slice.map((r) => {
        const fi = r.feed_items as unknown as {
          description: string | null;
          body_md: string | null;
        };
        return {
          intelId: r.id as string,
          feedItemId: r.feed_item_id as number,
          intentLabel: r.intent_label as IntelRowForTake["intentLabel"],
          confidence: Number(r.confidence),
          modusOperandi: r.modus_operandi as string | null,
          narrativeSummary: r.narrative_summary as string | null,
          tacticTags: (r.tactic_tags as string[]) ?? [],
          brandsImpersonated: (r.brands_impersonated as string[]) ?? [],
          countryHints: (r.country_hints as string[]) ?? [],
          isEmerging: Boolean(r.is_emerging),
          isScamReport: (r.is_scam_report as boolean | null) ?? null,
          sourceText: fi?.body_md ?? fi?.description ?? "",
        };
      });

      const out = await generateTakesForPosts(inputs);

      for (const t of out.results) {
        const { error: upErr } = await supabase
          .from("reddit_post_intel")
          .update({
            take_status: t.takeStatus,
            take_suppressed_reason: t.takeSuppressedReason,
            take_tells: t.takeTells,
            take_where: t.takeWhere,
            take_au_line: t.takeAuLine,
            take_model_version: t.takeModelVersion,
            take_prompt_version: t.takePromptVersion,
            take_written_at: new Date().toISOString(),
          })
          .eq("id", t.intelId);
        if (upErr) console.error(`update ${t.intelId}: ${upErr.message}`);
      }

      return {
        costUsd: out.estimatedCostUsd,
        units: out.inputTokens + out.outputTokens,
        metadata: {
          model: out.modelId,
          posts: inputs.length,
          ready: out.readyCount,
          suppressed: out.suppressedCount,
          truncatedFields: out.truncatedFieldCount,
        },
        summary:
          `ready ${out.readyCount} · suppressed ${out.suppressedCount}` +
          (out.truncatedFieldCount > 0
            ? ` · ${out.truncatedFieldCount} cut short`
            : ""),
      };
    },
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
