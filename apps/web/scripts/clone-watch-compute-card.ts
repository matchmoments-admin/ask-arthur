/**
 * Compute the month's report card ONCE and pin it.
 *
 *   pnpm --filter @askarthur/web clone-watch:compute-card -- --month=2026-08 --out=./out
 *
 * Writes `<out>/card.json` AND `clone_watch_report_summary.card_json` (v298),
 * so the slide export (`?pinned=1`), the caption and the post-approval publish
 * write-back all quote identical numbers.
 *
 * WHY THIS EXISTS. A published edition used to be assembled from three-to-five
 * INDEPENDENT reads of `shopfront_clone_alerts` — a table whose lifecycle
 * columns the reconciler mutates daily, and which every KPI on slide 06 reads:
 *
 *   - the slide export hit /admin/report-card once PER SLIDE (8, up to 24 with
 *     its retry loop), each a fresh card build inside the prod Next server;
 *   - the caption built the card again, in the GH runner, minutes later;
 *   - the publish write-back built it a THIRD time — after the GitHub
 *     Environment approval gate, which is unbounded (hours to days).
 *
 * So the PDF the founder approved and the row persisted afterwards were
 * computed from different snapshots. clone-watch-caption.ts's header claimed
 * the caption "always matches the carousel"; that was true per-read and false
 * across the pipeline. This step is the fix: one read, one card, one edition.
 *
 * Idempotent — re-running for the same month recomputes and re-pins. Requires
 * SUPABASE_* env.
 */
import "./_load-env-config";
import fs from "node:fs/promises";
import path from "node:path";
import { createServiceClient } from "@askarthur/supabase/server";
import { loadCardInputs } from "../lib/clone-watch/report-card-data";
import { buildReportCard } from "../lib/clone-watch/report-card";
import { upsertSummary } from "../lib/clone-watch/report-summary";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

async function main() {
  const month = arg("month");
  const outDir = path.resolve(arg("out") ?? "report-card-out");
  const skipWrite = process.argv.includes("--no-write");

  // ONE load, both folds — the same shape the monthly cron uses.
  const inputs = await loadCardInputs(month);
  const card = buildReportCard(inputs);

  await fs.mkdir(outDir, { recursive: true });
  const cardPath = path.join(outDir, "card.json");
  await fs.writeFile(cardPath, `${JSON.stringify(card, null, 2)}\n`);

  // REFUSE to pin an empty edition. The monthly cron has this guard
  // (clone-watch-report-summary.ts: `skipped: "no_clones"`); this script,
  // which the GH lane runs with an operator-supplied --month, did not. A typo
  // month, a paused sweep or a pre-launch month yields total 0, and the upsert
  // would then overwrite a good `clone_watch_report_summary` row with zeros and
  // an empty card_json. out/card.json is already written above, so a dry
  // inspection still works; only the destructive half is refused.
  if (card.total === 0) {
    console.error(
      `clone-watch:compute-card: ${card.periodMonth} has NO clones — refusing to pin` +
        ` (would overwrite the stored edition with zeros). Wrote ${cardPath} only.`,
    );
    process.exit(1);
  }

  if (!skipWrite) {
    const sb = createServiceClient();
    if (!sb) throw new Error("service client unavailable");
    // upsertSummary writes card_json; omitting the URN preserves an already
    // recorded LinkedIn post (the publish step owns that column).
    await upsertSummary(sb, card);
    // NO writeTrendRows here, deliberately. It is delete-then-insert against
    // clone_watch_monthly_brand_stats / _registrar_stats, and this script runs
    // as an un-retried GitHub Actions step — a runner eviction between the
    // delete and the insert loses that month's trend rows outright. The monthly
    // cron owns those tables and does the same write with `retries: 2`.
    // Correctness argues the same way: a re-pin of a PAST month must state what
    // was true THEN, and rewriting its trend rows from today's data is exactly
    // the re-export bug this pipeline has already been bitten by twice.
  }

  console.log(
    `pinned ${card.periodMonth}: ${card.total} detected / ${card.brands} brands` +
      ` · spotlight ${card.spotlight.kind}${card.spotlight.brand ? ` (${card.spotlight.brand})` : ""}` +
      ` · watchlist ${card.watchlistSize}`,
  );
  console.log(`wrote ${cardPath}${skipWrite ? " (--no-write: DB not touched)" : " + card_json"}`);
}

main().catch((err) => {
  console.error(
    "clone-watch:compute-card failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
