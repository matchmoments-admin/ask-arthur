/**
 * Generic LinkedIn document (carousel) publisher for the Ask Arthur company page.
 *
 *   pnpm --filter @askarthur/web linkedin:document -- \
 *     --pdf=out/ask-arthur-hub.pdf \
 *     --caption-file=docs/linkedin/hub-launch-caption.txt \
 *     --title="Ask Arthur — the hub" \
 *     [--comment="first comment text"] \
 *     [--dry-run]
 *
 * WHY THIS EXISTS SEPARATELY FROM clone-watch-publish.ts
 * That publisher is bound to the monthly edition: it keys its duplicate guard
 * and its write-back on `clone_watch_report_summary.published_post_urn` for a
 * given month. A one-off deck has no month and no summary row, so reusing it
 * would mean either faking a month or writing a row that means nothing. This
 * script is the same LinkedIn calls with the month-shaped machinery removed —
 * both go through lib/linkedin/client.ts, which stays the single place that
 * knows the API.
 *
 * DESTRUCTIVE. createDocumentPost publishes PUBLIC / MAIN_FEED immediately —
 * LinkedIn's API has no draft state at this tier. `--dry-run` stops after the
 * upload so the whole path can be exercised without publishing.
 *
 * NO AUTOMATIC DUPLICATE GUARD, deliberately: with no month key there is
 * nothing durable to guard on, and inventing a marker table for a one-off is
 * worse than the two human gates already in front of this — the workflow is
 * `workflow_dispatch` only (someone must trigger it) and its publish job sits
 * behind a required-reviewer Environment (someone must approve it). Running it
 * twice takes two deliberate approvals. The post URL is printed either way, so
 * a repeat is visible immediately.
 *
 * Prints machine-readable RESULT / URL / VERIFY lines for a workflow to branch on.
 */
import "./_load-env-config";
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveAccessToken,
  orgUrn,
  uploadDocument,
  createDocumentPost,
  addComment,
  postUrl,
  verifyPost,
} from "../lib/linkedin/client";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const pdfPath = arg("pdf");
  const captionFile = arg("caption-file");
  const title = arg("title");
  const comment = arg("comment");
  const dryRun = flag("dry-run");

  if (!pdfPath) throw new Error("--pdf is required");
  if (!captionFile) throw new Error("--caption-file is required");
  if (!title) throw new Error("--title is required");

  const pdf = await fs.readFile(path.resolve(pdfPath));
  const caption = (await fs.readFile(path.resolve(captionFile), "utf8")).trim();
  if (!caption) throw new Error(`caption file ${captionFile} is empty`);
  // LinkedIn truncates commentary past 3000 chars. Fail loudly rather than ship
  // a post whose closing line and link silently vanished.
  if (caption.length > 3000) {
    throw new Error(`caption is ${caption.length} chars; LinkedIn's limit is 3000`);
  }

  // HARD BOUNDARY: this lane posts as the COMPANY, never as a person.
  // createDocumentPost/uploadDocument each accept an optional authorUrn/ownerUrn
  // override and this script passes neither, so the author is always orgUrn().
  // That is a property of today's code, not a guarantee. This assertion makes it
  // one: if LINKEDIN_ORG_URN is ever pointed at a urn:li:person:… — a
  // misconfigured secret, a token minted from a personal profile — the run stops
  // here rather than publishing to somebody's personal feed, which is not
  // undoable in any way that matters.
  const author = orgUrn();
  if (!author.startsWith("urn:li:organization:")) {
    throw new Error(
      `refusing to post: LINKEDIN_ORG_URN is "${author}", not a urn:li:organization: — ` +
        `this lane publishes to the company page only`,
    );
  }

  console.log(`pdf      : ${pdfPath} (${Math.round(pdf.byteLength / 1024)} KB)`);
  console.log(`caption  : ${caption.length} chars`);
  console.log(`title    : ${title}`);
  console.log(`author   : ${author} (company page)`);

  const accessToken = await resolveAccessToken();

  const documentUrn = await uploadDocument(pdf, accessToken);
  console.log(`uploaded : ${documentUrn}`);

  if (dryRun) {
    console.log("RESULT=dry-run");
    console.log("URL=");
    console.log("VERIFY=skipped");
    console.log("\n--dry-run: uploaded the document but did NOT publish.");
    return;
  }

  const postUrn = await createDocumentPost({
    documentUrn,
    title,
    commentary: caption,
    accessToken,
  });
  const url = postUrl(postUrn);
  console.log(`RESULT=published`);
  console.log(`URL=${url}`);

  // First comment is best-effort: LinkedIn Dev-Tier 403s comment creation, and
  // that must not red a step that has already posted successfully.
  if (comment) {
    try {
      await addComment({ postUrn, text: comment, accessToken });
      console.log("comment  : posted");
    } catch (e) {
      console.log(
        `comment  : FAILED (expected on Dev-Tier) — paste by hand: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  const verdict = await verifyPost({ postUrn, accessToken });
  const problems = Array.isArray(verdict?.problems) ? verdict.problems : [];
  console.log(`VERIFY=${problems.length === 0 ? "ok" : "problems"}`);
  if (problems.length > 0) {
    for (const p of problems) console.log(`  ⚠ ${p}`);
  }

  // Green here is NECESSARY, NOT SUFFICIENT. On 2026-08-07 the July edition
  // returned 201, read back PUBLISHED/PUBLIC/MAIN_FEED with an AVAILABLE
  // document, and still rendered "Post cannot be displayed". LinkedIn exposes
  // no member-visibility signal at this tier, so no automated check can close
  // that gap — open the URL and look.
  console.log(`\nOpen and confirm it renders: ${url}`);
}

main().catch((err) => {
  console.error("linkedin document post failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
