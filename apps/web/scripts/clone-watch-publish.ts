/**
 * Guarded Clone-Watch LinkedIn publisher (the automation's publish step).
 *
 *   pnpm --filter @askarthur/web clone-watch:publish -- \
 *     --pdf=out/clone-watch-2026-07.pdf --caption-file=out/caption.txt \
 *     --comment="$(cat out/first-comment.txt)" --title="…" --month=2026-07
 *
 * Wraps the LinkedIn client with two safety rails around double-posting:
 *   1. DUPLICATE GUARD — if clone_watch_report_summary already has a
 *      published_post_urn for the month, it SKIPS (green no-op) rather than
 *      posting again. `--force` overrides (e.g. a deliberate re-post after a
 *      manual delete).
 *   2. WRITE-BACK — after a successful post, records the URN into the summary
 *      row, creating/refreshing the row from live data so it works even when the
 *      monthly snapshot hasn't run yet.
 *
 * Prints machine-readable `RESULT=<published|skipped>` and `URL=<feed-url>` for
 * the workflow to branch on. Requires LINKEDIN_* + SUPABASE_* env.
 */
import "./_load-env-config";
import fs from "node:fs";
import { createServiceClient } from "@askarthur/supabase/server";
import {
  resolveAccessToken,
  uploadDocument,
  createDocumentPost,
  addComment,
  postUrl,
  verifyPost,
} from "../lib/linkedin/client";
import { getCloneWatchReportCard } from "../lib/clone-watch/report-card-data";
import { getPublishedUrn, upsertSummary } from "../lib/clone-watch/report-summary";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const pdfPath = arg("pdf");
  const captionFile = arg("caption-file");
  const comment = arg("comment");
  const title = arg("title") || "Australian Clone Watch";
  const month = arg("month");
  const force = has("force");
  if (!pdfPath || !captionFile || !comment || !month) {
    throw new Error("--pdf, --caption-file, --comment and --month are required");
  }
  const ym = month.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error(`invalid --month "${month}"`);
  const periodMonth = `${ym}-01`;

  const sb = createServiceClient();
  if (!sb) throw new Error("service client unavailable");

  // ── 1. Duplicate guard ────────────────────────────────────────────────────
  const existing = await getPublishedUrn(sb, periodMonth);
  if (existing && !force) {
    console.log("RESULT=skipped");
    console.log(`URL=${postUrl(existing)}`);
    console.log(
      `\n⏭  ${ym} already published (${existing}) — skipping to avoid a double-post. Pass --force to override.`,
    );
    return;
  }
  if (existing && force) {
    console.log(`(--force: re-posting ${ym} despite an existing URN ${existing})`);
  }

  // ── 2. Publish ────────────────────────────────────────────────────────────
  const commentary = fs.readFileSync(captionFile, "utf8").trim();
  const pdf = new Uint8Array(fs.readFileSync(pdfPath));
  console.log(`Publishing ${ym} (${(pdf.length / 1024).toFixed(0)} KB PDF)…`);
  const token = await resolveAccessToken();
  const documentUrn = await uploadDocument(pdf, token);
  const post = await createDocumentPost({ documentUrn, title, commentary, accessToken: token });
  console.log("RESULT=published");
  console.log(`URL=${postUrl(post)}`);
  console.log(`\n✓ PUBLISHED: ${postUrl(post)}  (urn ${post})`);

  // ── 2b. Verify — read the post back rather than trusting the 201 ──────────
  // A 201 means "LinkedIn accepted the request", NOT "the post is visible".
  // The July 2026 edition proved the gap: 201 + every field healthy, and the
  // post still rendered "Post cannot be displayed" and never appeared on the
  // page. So we assert what the API CAN tell us, print VERIFY=..., and — pass
  // or fail — always tell the operator to eyeball the URL, because member
  // visibility is not observable at this API tier.
  const v = await verifyPost({ postUrn: post, accessToken: token });
  console.log(`VERIFY=${v.ok ? "ok" : "problems"}`);
  console.log(
    `  state=${v.lifecycleState ?? "?"} visibility=${v.visibility ?? "?"} ` +
      `distribution=${v.feedDistribution ?? "?"} document=${v.documentStatus ?? "?"} ` +
      `inAuthorListing=${v.inAuthorListing ?? "?"}`,
  );
  for (const p of v.problems) console.log(`  ⚠ ${p}`);
  console.log(
    "  NOTE: these checks cannot prove a member can SEE the post — LinkedIn exposes\n" +
      "        no member-visibility signal at Development tier. Open the URL and confirm\n" +
      "        it renders before treating this edition as published.",
  );

  // ── 3. Write-back — record the URN (creates/refreshes the row from live data,
  //       so a re-run is guarded even if the monthly snapshot hasn't run) ──────
  try {
    const card = await getCloneWatchReportCard(month);
    await upsertSummary(sb, card, post);
    console.log(`  ✓ recorded post URN in clone_watch_report_summary (${periodMonth})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      `  ⚠ post is LIVE but recording the URN failed: ${msg}\n    ${ym} is now UNGUARDED — record the URN by hand before ANY re-run (UPDATE clone_watch_report_summary SET published_post_urn='${post}' WHERE period_month='${periodMonth}'), or a re-run will double-post.`,
    );
  }

  // ── First comment (best-effort — Dev-Tier 403s on comment-create) ─────────
  console.log("  adding first comment (link)…");
  try {
    await addComment({ postUrn: post, text: comment, accessToken: token });
    console.log("  ✓ first comment added");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠ could not add first comment automatically: ${msg}`);
    console.log(`  → add this as the FIRST COMMENT manually:\n\n      ${comment}\n`);
  }
}

main().catch((err) => {
  console.error("clone-watch:publish failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
