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
import { isFeatureBraked, logCost } from "@askarthur/scam-engine/cost-log";
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

  if (await isFeatureBraked("reddit_intel")) {
    console.log("feature_brakes.reddit_intel is engaged — refusing to spend.");
    return;
  }

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
  if (candidates.length === 0) return;

  // --dry stops HERE, before the model call.
  //
  // It used to stop one step later, guarding only the writes, so a "dry" run
  // generated every take for real, paid for it, and threw the result away —
  // and because the same guard also skipped logCost, that spend never reached
  // cost_telemetry, the daily cap or the weekly digest. Measured: one dry run
  // over 125 rows cost US$0.14 that no dashboard can see.
  //
  // Untracked spend is the worse half of that. Even if the generation were
  // wanted, it would have to be logged. But it is not wanted: previewing what
  // a take reads like is _take-dryrun.ts's job, and it is explicit about
  // costing money. What this flag is for is answering "how many rows would
  // this touch, and what will it cost me" without spending to find out.
  if (DRY) {
    console.log(
      `DRY — no model call. ${candidates.length} rows would cost about US$${(candidates.length * 0.00101).toFixed(2)} at the measured rate.`,
    );
    return;
  }

  let ready = 0;
  let suppressed = 0;
  let failed = 0;
  let spend = 0;
  let batchFailures = 0;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
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

    // Per-batch isolation.
    //
    // Without it, one malformed model response ends the run. That is not
    // hypothetical: on 2026-09-05 batch 118 of 133 came back with `takes` as a
    // JSON string, the schema threw, and the throw propagated out of the loop
    // and abandoned the remaining 16 batches — 382 rows silently left behind
    // while the process exited. The rows already written were fine, so nothing
    // looked broken; the run just stopped early.
    //
    // A batch is independent of every other batch. The correct response to one
    // failing is to record it and keep going, and to make the count loud at
    // the end so a short run cannot be mistaken for a complete one.
    let out: Awaited<ReturnType<typeof generateTakesForPosts>>;
    try {
      out = await generateTakesForPosts(inputs);
    } catch (e) {
      batchFailures += 1;
      failed += inputs.length;
      console.error(
        `  batch ${i / BATCH + 1}: FAILED (${inputs.length} rows left for a later run) — ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      continue;
    }
    spend += out.estimatedCostUsd;

    // Log to cost_telemetry under the SAME tag the live path uses, on every
    // path that spends. An operator script that spends real money and records
    // nothing is invisible to the brake, to /admin/costs and to the weekly
    // digest — which is the exact "unmetered spend" gap that had to be fixed
    // for the Inngest step, and which this script then reintroduced behind
    // --dry. There is deliberately no flag that skips this: if the code
    // reached here, money was spent, so it gets recorded.
    {
      await logCost({
        feature: "reddit-intel-take",
        provider: "anthropic",
        operation: "messages.create",
        units: out.inputTokens + out.outputTokens,
        estimatedCostUsd: out.estimatedCostUsd,
        metadata: {
          model: out.modelId,
          posts: inputs.length,
          ready: out.readyCount,
          suppressed: out.suppressedCount,
          truncatedFields: out.truncatedFieldCount,
          via: REGENERATE_TRUNCATED ? "regenerate_truncated" : "backfill_script",
        },
      });
    }

    for (const t of out.results) {
      if (t.takeStatus === "ready") ready += 1;
      else if (t.takeStatus === "suppressed") suppressed += 1;
      else failed += 1;

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

    console.log(
      `  batch ${i / BATCH + 1}: ready ${out.readyCount} · suppressed ${out.suppressedCount}` +
        (out.truncatedFieldCount > 0 ? ` · ${out.truncatedFieldCount} cut short` : "") +
        ` · US$${out.estimatedCostUsd.toFixed(4)}`,
    );
  }

  console.log(
    `\ntotal — ready ${ready} · suppressed ${suppressed} · failed ${failed} · US$${spend.toFixed(4)}`,
  );

  // Loud, and a non-zero exit. A partial run that reports like a complete one
  // is how 382 rows went missing without anyone noticing the first time.
  if (batchFailures > 0) {
    console.error(
      `\n${batchFailures} of ${Math.ceil(candidates.length / BATCH)} batches failed. ` +
        `Re-run the same command — rows without a take are still selected, so it picks up where this left off.`,
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
