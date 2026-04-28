/**
 * Seed 4 SPF-pillar blog posts: pillar + 3 supporting.
 *
 * Reads content from the canonical markdown files under
 * docs/campaigns/spf-pillar-2026-04/ so there is one source of truth.
 * The script strips the leading H1, subtitle, and separator from each
 * file (those live in their own database columns) and inserts the
 * remaining body as content.
 *
 * Posts are inserted as status: "draft" — review in /admin/blog before
 * flipping to "published" per the publication schedule in
 * docs/campaigns/spf-pillar-2026-04/00-master-cover.md.
 *
 * Usage: npx tsx apps/web/scripts/seed-spf-pillar-blogs.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// Content loading — reads canonical markdown, strips header block
// ---------------------------------------------------------------------------

// Resolve relative to this script's location, not cwd, so the seed runs
// correctly from any working directory (project root, apps/web, …).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CAMPAIGN_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "docs/campaigns/spf-pillar-2026-04"
);

/**
 * Strip the leading H1 + subtitle italic line + horizontal-rule separator
 * from a deliverable markdown file. Title/subtitle live in the database;
 * `content` is body-only.
 *
 * Pattern in source files:
 *   # Title line
 *   <blank>
 *   **Subtitle line**
 *   <blank>
 *   ---
 *   <blank>
 *   <body starts here>
 */
function loadBody(filename: string): string {
  const raw = readFileSync(join(CAMPAIGN_DIR, filename), "utf-8");
  const lines = raw.split("\n");

  let i = 0;
  // Skip optional leading blank lines
  while (i < lines.length && lines[i].trim() === "") i++;
  // Skip H1
  if (lines[i]?.startsWith("# ")) i++;
  // Skip blank
  while (i < lines.length && lines[i].trim() === "") i++;
  // Skip subtitle (bold-only line, no other content)
  if (lines[i]?.startsWith("**") && lines[i]?.endsWith("**")) i++;
  // Skip blank
  while (i < lines.length && lines[i].trim() === "") i++;
  // Skip horizontal rule
  if (lines[i]?.trim() === "---") i++;
  // Skip blank
  while (i < lines.length && lines[i].trim() === "") i++;

  return lines.slice(i).join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Category bootstrap
// ---------------------------------------------------------------------------

async function ensureCategoryExists(
  slug: string,
  name: string,
  description: string,
  sortOrder: number
): Promise<void> {
  const { data } = await supabase
    .from("blog_categories")
    .select("slug")
    .eq("slug", slug)
    .single();

  if (!data) {
    const { error } = await supabase.from("blog_categories").insert({
      name,
      slug,
      description,
      sort_order: sortOrder,
    });
    if (error) {
      console.error(`  ERROR creating category "${slug}":`, error.message);
    } else {
      console.log(`  Created category: ${slug}`);
    }
  } else {
    console.log(`  Category "${slug}" already exists`);
  }
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  content: string;
  author: string;
  tags: string[];
  category_slug: string;
  hero_image_url: string | null;
  status: string;
  is_featured: boolean;
  seo_title: string;
  meta_description: string;
  reading_time_minutes: number;
  published_at: string;
}

const posts: BlogPost[] = [
  {
    slug: "spf-telco-readiness-1-july-2026",
    title:
      "Five penalties, one rejected code, sixty-four days: why every Australian telco except Telstra is a buyer of scam intelligence",
    subtitle:
      "Why every Australian telco except Telstra is a buyer, not a builder, of scam intelligence by 1 July 2026.",
    excerpt:
      "Six telco penalties in twelve months. ACMA's draft consumer code rejected twice. SPF Act commences 1 July 2026 with A$52.7M maximum penalties. Here's what changes — and why every Australian telco except Telstra will be a buyer of scam intelligence.",
    content: loadBody("01-pillar-blog-post.md"),
    author: "Brendan Milton",
    tags: [
      "spf",
      "compliance",
      "regulation",
      "telcos",
      "acma",
      "australia",
      "spf-act",
    ],
    category_slug: "compliance",
    hero_image_url:
      "/illustrations/blog/spf-pillar-2026-04/pillar-hero-a-calendar.webp",
    status: "draft",
    is_featured: true,
    seo_title:
      "SPF Act 2026: Why Every Telco Except Telstra Is a Buyer of Scam Intelligence",
    meta_description:
      "Six ACMA telco penalties, A$52.7M SPF Act fines from 1 July 2026, and a rejected industry code. The complete strategic read for Australian telco compliance leads.",
    reading_time_minutes: 14,
    published_at: new Date().toISOString(),
  },
  {
    slug: "spf-159745-penalty-units-explained",
    title:
      "What '159,745 penalty units' actually means for an Australian telco on 2 July 2026",
    subtitle:
      "The maximum SPF penalty isn't the headline number you've been told. Here's the arithmetic — and the indexation event nobody is talking about.",
    excerpt:
      "The SPF Act Tier 1 maximum is the greater of three numbers. The A$52.7M figure is the floor, not the ceiling. And it changes on 1 July 2026 due to penalty unit indexation.",
    content: loadBody("05-blog-supporting-1-penalty-units.md"),
    author: "Brendan Milton",
    tags: ["spf", "compliance", "penalty-units", "regulation", "australia"],
    category_slug: "compliance",
    hero_image_url: null,
    status: "draft",
    is_featured: false,
    seo_title:
      "SPF Act Penalty Units Explained: What A$52.7 Million Actually Means in 2026",
    meta_description:
      "The SPF Act's Tier 1 maximum is the greater of A$52.7M, 3x benefit derived, or 30% of turnover. Here's how the arithmetic works and why the number changes 1 July 2026.",
    reading_time_minutes: 6,
    published_at: new Date().toISOString(),
  },
  {
    slug: "sms-sender-id-register-cio-guide-2026",
    title:
      "The SMS Sender ID Register goes live in sixty-four days. Here's what most CIOs still get wrong",
    subtitle:
      "Five common misconceptions about the Sender ID Register, and what to do this quarter to avoid Day-1 customer-service crises.",
    excerpt:
      "The SMS Sender ID Register becomes mandatory 1 July 2026. From that date, unregistered alphanumeric sender IDs display as 'Unverified' to recipients. Here's what most CIOs still get wrong.",
    content: loadBody("06-blog-supporting-2-sender-id.md"),
    author: "Brendan Milton",
    tags: ["sms", "sender-id", "compliance", "regulation", "australia", "acma"],
    category_slug: "compliance",
    hero_image_url: null,
    status: "draft",
    is_featured: false,
    seo_title:
      "SMS Sender ID Register Australia 2026: CIO Compliance Guide for 1 July",
    meta_description:
      "The SMS Sender ID Register becomes mandatory 1 July 2026. Five misconceptions CIOs still have, and the inventory work to do this quarter.",
    reading_time_minutes: 7,
    published_at: new Date().toISOString(),
  },
  {
    slug: "five-telcos-twelve-months-acma-pattern",
    title: "Five telcos. Twelve months. One audit finding repeated six times.",
    subtitle:
      "What ACMA's enforcement pattern across six telco penalties tells you about the 2026 SPF baseline.",
    excerpt:
      "Six ACMA telco infringement notices in twelve months. One audit finding repeated six times. ACMA's draft consumer code rejected. Here's what the regulator's revealed preference tells you about SPF compliance.",
    content: loadBody("07-blog-supporting-3-five-fines.md"),
    author: "Brendan Milton",
    tags: [
      "acma",
      "telcos",
      "compliance",
      "regulation",
      "spf",
      "enforcement",
      "australia",
    ],
    category_slug: "compliance",
    hero_image_url:
      "/illustrations/blog/spf-pillar-2026-04/pillar-hero-b-folders.webp",
    status: "draft",
    is_featured: false,
    seo_title:
      "ACMA Telco Penalties 2024-2026: The Pattern Behind Six Identical Findings",
    meta_description:
      "Six ACMA telco infringement notices in twelve months. The same audit finding repeated six times. What this tells you about SPF Act baseline expectations.",
    reading_time_minutes: 7,
    published_at: new Date().toISOString(),
  },
];

async function main() {
  console.log("Seeding 4 SPF-pillar blog posts as drafts...\n");

  await ensureCategoryExists(
    "compliance",
    "Compliance",
    "Regulatory compliance guides for the Scams Prevention Framework and Australian consumer protection law",
    5
  );

  let upserted = 0;

  for (const post of posts) {
    const { error } = await supabase.from("blog_posts").upsert(
      {
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        excerpt: post.excerpt,
        content: post.content,
        author: post.author,
        tags: post.tags,
        category_slug: post.category_slug,
        hero_image_url: post.hero_image_url,
        status: post.status,
        is_featured: post.is_featured,
        seo_title: post.seo_title,
        meta_description: post.meta_description,
        reading_time_minutes: post.reading_time_minutes,
        published_at: post.published_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" }
    );

    if (error) {
      console.error(`  ERROR upserting "${post.title}":`, error.message);
    } else {
      console.log(`  OK: "${post.title}" (status: ${post.status})`);
      upserted++;
    }
  }

  console.log(`\nDone: ${upserted} posts upserted as drafts.`);
  console.log("Review in /admin/blog before flipping to 'published'.");
  console.log(
    "Publication schedule: docs/campaigns/spf-pillar-2026-04/00-master-cover.md"
  );
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
