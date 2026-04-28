/**
 * Update the content + updated_at of a single existing blog post from a
 * markdown file. Strips the leading H1 + subtitle + separator the same way
 * the SPF seed script does, so the markdown's title/subtitle live in the
 * database columns and only the body is treated as content.
 *
 * Usage:
 *   npx tsx apps/web/scripts/update-blog-content.ts <slug> <path-to-md>
 *
 * Example:
 *   npx tsx apps/web/scripts/update-blog-content.ts how-ask-arthur-works \
 *     docs/blog/how-ask-arthur-works.md
 *
 * Run from project root so the markdown path resolves correctly. Requires
 * SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY in
 * env. Idempotent (just an upsert-shaped UPDATE on slug).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const [, , slug, mdPath] = process.argv;

if (!slug || !mdPath) {
  console.error("Usage: npx tsx scripts/update-blog-content.ts <slug> <path-to-md>");
  process.exit(2);
}

function loadBody(path: string): string {
  const raw = readFileSync(resolve(process.cwd(), path), "utf-8");
  const lines = raw.split("\n");

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i]?.startsWith("# ")) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i]?.startsWith("**") && lines[i]?.endsWith("**")) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i]?.trim() === "---") i++;
  while (i < lines.length && lines[i].trim() === "") i++;

  return lines.slice(i).join("\n").trimEnd();
}

async function main() {
  const supabase = createClient(supabaseUrl!, supabaseKey!);
  const content = loadBody(mdPath);

  console.log(`Updating blog_posts.content for slug="${slug}"`);
  console.log(`  source: ${mdPath}`);
  console.log(`  body chars: ${content.length}`);

  const { data, error } = await supabase
    .from("blog_posts")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("slug", slug)
    .select("slug, status, updated_at");

  if (error) {
    console.error("ERROR:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.error(`No blog_posts row found with slug="${slug}". Nothing updated.`);
    process.exit(1);
  }

  console.log(`OK: updated ${data.length} row(s).`);
  for (const row of data) {
    console.log(`  ${row.slug} (${row.status}) → ${row.updated_at}`);
  }
}

main().catch((err) => {
  console.error("Update failed:", err);
  process.exit(1);
});
