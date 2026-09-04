/**
 * Arthur's Take — dry run. READ-ONLY: makes one real Claude call, writes nothing.
 *
 *   pnpm --filter @askarthur/web tsx scripts/_take-dryrun.ts [count]
 *
 * The point is to see what the model actually produces before any surface is
 * built on it. The prompt forbids amounts, but the CLASSIFIER's prompt permits
 * them and its output uses them ("requires a model to pay $95 upfront"), so
 * the writer inheriting that habit is the expected case, not the unlucky one.
 * If the validator suppresses most of a real sample, the fix is the prompt —
 * and finding that out here costs about a cent instead of a rebuild.
 *
 * Untracked session tooling, `_`-prefixed like _query.ts and _apply-migration.ts.
 */
import "./_load-env-config";

import { createServiceClient } from "@askarthur/supabase/server";
import {
  generateTakesForPosts,
  type IntelRowForTake,
} from "@askarthur/scam-engine/reddit-intel/takes";

const COUNT = Number(process.argv[2] ?? 10);

async function main() {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("no supabase service client");

  // Newest classified rows with a real body, joined to the source text the
  // generator would actually see in production.
  const { data, error } = await supabase
    .from("reddit_post_intel")
    .select(
      "id, feed_item_id, intent_label, confidence, modus_operandi, narrative_summary, tactic_tags, brands_impersonated, country_hints, is_emerging, is_scam_report, take_status, feed_items(title, description, body_md, source_url)",
    )
    .order("processed_at", { ascending: false })
    .limit(COUNT);

  if (error) throw new Error(error.message);

  const rows: IntelRowForTake[] = (data ?? []).map((r) => {
    const fi = r.feed_items as unknown as {
      title: string | null;
      description: string | null;
      body_md: string | null;
      source_url: string | null;
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

  console.log(`\ndry run over ${rows.length} real rows — NO WRITES\n`);

  const out = await generateTakesForPosts(rows);

  for (const result of out.results) {
    const src = rows.find((r) => r.feedItemId === result.feedItemId);
    const fi = (data ?? []).find(
      (d) => d.feed_item_id === result.feedItemId,
    )?.feed_items as unknown as { title?: string } | undefined;

    console.log("─".repeat(78));
    console.log(`feed_item ${result.feedItemId} · ${src?.intentLabel} · conf ${src?.confidence}`);
    console.log(`TITLE   ${(fi?.title ?? "").slice(0, 70)}`);
    console.log(`SOURCE  ${(src?.sourceText ?? "").slice(0, 160).replace(/\s+/g, " ")}…`);
    console.log(`STATUS  ${result.takeStatus}${result.takeSuppressedReason ? ` (${result.takeSuppressedReason})` : ""}`);
    if (result.takeStatus === "ready") {
      for (const t of result.takeTells) console.log(`  tell  • ${t}`);
      console.log(`  where   ${result.takeWhere ?? "—"}`);
      console.log(`  AU      ${result.takeAuLine ?? "—"}`);
    }
  }

  console.log("─".repeat(78));
  console.log(
    `\nready ${out.readyCount} · suppressed ${out.suppressedCount} · failed ${
      out.results.length - out.readyCount - out.suppressedCount
    }`,
  );
  console.log(
    `model ${out.modelId} · in ${out.inputTokens} out ${out.outputTokens} tok · US$${out.estimatedCostUsd.toFixed(5)}${out.truncated ? " · TRUNCATED" : ""}\n`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
