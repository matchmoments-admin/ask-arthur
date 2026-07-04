/**
 * LinkedIn poster validation CLI (slice A).
 *
 * SAFE by default: resolves an access token (via the refresh grant), uploads a
 * PDF document, and prints the document URN. An uploaded-but-unattached
 * document is NOT publicly visible, so this validates auth + scopes + the
 * versioned Community Management API without posting anything.
 *
 *   pnpm --filter @askarthur/web linkedin:test -- --pdf=/tmp/rc-out3/clone-watch-2026-06.pdf
 *
 * DESTRUCTIVE with --publish: also creates the PUBLIC document post on the page
 * and adds the first comment. Requires --caption-file and --comment.
 *
 *   pnpm --filter @askarthur/web linkedin:test -- --pdf=... --caption-file=cap.txt \
 *     --comment="Check any link: https://askarthur.au" --title="Australian Clone Watch - June 2026" --publish
 *
 * Reads LINKEDIN_* from apps/web/.env.local (dotenv).
 */
import "dotenv/config";
import fs from "node:fs";
import {
  resolveAccessToken,
  uploadDocument,
  createDocumentPost,
  addComment,
  postUrl,
  orgUrn,
} from "../lib/linkedin/client";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const pdfPath = arg("pdf");
  if (!pdfPath) throw new Error("--pdf=<path> is required");
  const pdf = new Uint8Array(fs.readFileSync(pdfPath));
  console.log(`PDF: ${pdfPath} (${(pdf.length / 1024).toFixed(0)} KB)`);
  console.log(`Org: ${orgUrn()}`);

  console.log("\nResolving access token (refresh grant if available)...");
  const token = await resolveAccessToken();
  console.log("  access token OK");

  console.log("\nUploading document (non-destructive)...");
  const documentUrn = await uploadDocument(pdf, token);
  console.log(`  uploaded -> ${documentUrn}`);
  console.log("\n✓ SAFE CHECK PASSED - auth, scopes, and versioned API all work.");

  if (!has("publish")) {
    console.log("\n(no --publish flag: stopping here, nothing was posted.)");
    return;
  }

  const captionFile = arg("caption-file");
  const comment = arg("comment");
  const title = arg("title") || "Australian Clone Watch";
  if (!captionFile || !comment) {
    throw new Error("--publish requires --caption-file=<path> and --comment=<text>");
  }
  const commentary = fs.readFileSync(captionFile, "utf8").trim();

  console.log("\n--publish set: creating the PUBLIC post on the page...");
  const post = await createDocumentPost({ documentUrn, title, commentary, accessToken: token });
  console.log(`  posted -> ${post}`);
  console.log(`\n✓ PUBLISHED: ${postUrl(post)}`);

  // First comment (the links). The Community Management API DEVELOPMENT TIER
  // grants post-create but NOT comment-create (403 ACCESS_DENIED). A comment
  // failure must NOT fail the run: the post is already live above, so exiting
  // non-zero here would make the operator (or the future auto-post cron) retry
  // and DOUBLE-POST. Surface the text to paste by hand instead.
  console.log("\n  adding first comment (link)...");
  try {
    await addComment({ postUrn: post, text: comment, accessToken: token });
    console.log("  ✓ first comment added");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠ could not add first comment automatically: ${msg}`);
    console.log("  → add this as the FIRST COMMENT manually:\n");
    console.log(`      ${comment}\n`);
  }
}

main().catch((err) => {
  console.error("\nlinkedin:test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
