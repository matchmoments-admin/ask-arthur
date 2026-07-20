/**
 * Clone-Watch caption generator CLI — used by the monthly LinkedIn workflow.
 *
 * Computes the report card for the given month (default: prior calendar month)
 * from live data and writes the deterministic caption + first-comment + document
 * title to <out>/ for the publish step to consume. Also prints them for the CI
 * log / the Telegram review ping.
 *
 *   pnpm --filter @askarthur/web clone-watch:caption -- --month=2026-06 --out=./out
 *
 * Requires SUPABASE_* env (getCloneWatchReportCard uses the service client).
 * Optional --method-url adds the "How we count these → …" line to the first
 * comment once the /clone-watch/method page is live.
 */
import "./_load-env-config";
import fs from "node:fs/promises";
import path from "node:path";
import { getCloneWatchReportCard } from "../lib/clone-watch/report-card-data";
import { generateCloneWatchCaption } from "../lib/clone-watch/clone-watch-caption";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

async function main() {
  const month = arg("month");
  const outDir = path.resolve(arg("out") ?? "report-card-out");
  const methodUrl = arg("method-url");

  const card = await getCloneWatchReportCard(month);
  const caption = generateCloneWatchCaption(card, methodUrl);

  // LinkedIn caps post commentary at ~3,000 chars. Fail HERE — in the prepare
  // job, before the approval gate — rather than let the publish step red after
  // founder approval + document upload (where a re-run risks a double-post).
  // 2,900 leaves headroom for LinkedIn's own entity-escaping.
  const CAPTION_MAX = 2_900;
  if (caption.bodyWithHashtags.length > CAPTION_MAX) {
    throw new Error(
      `caption is ${caption.bodyWithHashtags.length} chars (> ${CAPTION_MAX} safety cap for LinkedIn's ~3000 limit) — trim the month's blocks before publish`,
    );
  }

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "caption.txt"), `${caption.bodyWithHashtags}\n`);
  await fs.writeFile(path.join(outDir, "first-comment.txt"), `${caption.firstComment}\n`);
  await fs.writeFile(path.join(outDir, "title.txt"), `${caption.documentTitle}\n`);

  console.log(`# ${caption.documentTitle}  (${card.periodMonth}, ${card.total} detected / ${card.brands} brands)\n`);
  console.log(caption.bodyWithHashtags);
  console.log(`\n--- FIRST COMMENT (paste by hand) ---\n${caption.firstComment}`);
}

main().catch((err) => {
  console.error("clone-watch:caption failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
