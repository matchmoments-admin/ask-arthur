/**
 * Insert the Arthur's Take feature-announcement post as a DRAFT.
 *
 *   pnpm --filter @askarthur/web tsx scripts/_seed-arthurs-take-post.ts [--dry]
 *
 * status='draft' deliberately: the RLS policy on blog_posts only exposes
 * published rows, so nothing is public until it is approved at /admin/blog.
 * That mirrors the monthly-intel generator, which also never auto-publishes.
 *
 * Field set follows seed-spf-pillar-blogs.ts rather than the monthly generator
 * — the generator writes `category` but not `category_slug`, so its rows render
 * with no category eyebrow and get no related posts. Both are set here.
 *
 * `published` is NEVER written: the column was dropped in v16 and writing it
 * is a hard PostgREST error.
 */
import "./_load-env-config";

import fs from "node:fs";
import path from "node:path";

import { createServiceClient } from "@askarthur/supabase/server";
import { appendBlogCtaBlock } from "@/lib/blog-cta";

const DRY = process.argv.includes("--dry");
const SLUG = "arthurs-take-launch";
const SOURCE = path.join(process.cwd(), "../../docs/blog/arthurs-take-launch.md");

/** Strip the YAML frontmatter — title/excerpt/etc live in DB columns. */
function splitFrontmatter(raw: string): { body: string } {
  const m = /^---\n[\s\S]*?\n---\n/.exec(raw);
  return { body: m ? raw.slice(m[0].length).trimStart() : raw };
}

async function main() {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("no supabase service client");

  const { body } = splitFrontmatter(fs.readFileSync(SOURCE, "utf8"));
  const words = body.split(/\s+/).filter(Boolean).length;

  const row = {
    slug: SLUG,
    title:
      "Arthur's Take: we stopped reposting scam reports and started explaining them",
    subtitle:
      "Every report in the feed now comes with a plain-language read of the pattern behind it — what gives it away, where it's showing up, and what it looks like here.",
    excerpt:
      "Our feed carried thousands of scam reports from around the world and added nothing to them. Now every report comes with a plain-language read of the pattern behind it — what gives it away, where it's showing up, and what it looks like in Australia.",
    // appendBlogCtaBlock is idempotent on its own marker; the renderer does not
    // add a CTA, so a directly-inserted row needs it explicitly.
    content: appendBlogCtaBlock(body),
    author: "Ask Arthur",
    tags: ["product", "arthurs-take", "scam-feed", "launch", "scam-explainer"],
    // BOTH: `category` satisfies the v265 CHECK, `category_slug` is the FK the
    // renderer actually reads for the eyebrow and related posts.
    category: "product",
    category_slug: "product",
    hero_image_url: "/illustrations/blog-product.webp",
    hero_image_alt:
      "Ask Arthur's scam feed, showing a pattern analysis beneath a reported scam",
    status: "draft",
    is_featured: false,
    seo_title: "Arthur's Take — pattern analysis on every scam report",
    meta_description:
      "Ask Arthur now explains the pattern behind every scam report in its feed: the tells, where it is showing up globally, and the Australian version when there is one.",
    reading_time_minutes: Math.max(1, Math.ceil(words / 200)),
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log(
    `${DRY ? "[dry] " : ""}${SLUG} — ${words} words, ${row.reading_time_minutes} min read, status=${row.status}`,
  );
  if (DRY) return;

  const { error } = await supabase
    .from("blog_posts")
    .upsert(row, { onConflict: "slug" });
  if (error) throw new Error(error.message);

  console.log(`inserted as DRAFT — review and publish at /admin/blog`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
