# Claude Code Implementation Instructions

These instructions are for executing the publication of the four blog posts (one pillar + three supporting) into AskArthur's existing blog system. The blog system is documented in your project knowledge — Supabase `blog_posts` table with markdown content rendered via `apps/web/lib/blogRenderer.ts`.

You are executing this in your local AskArthur monorepo with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set in your shell environment.

---

## Step 1: Verify the "compliance" category exists

The category was previously seeded via `apps/web/scripts/seed-priority-blogs.ts`. To confirm:

```bash
psql "$SUPABASE_URL" -c "SELECT slug, name FROM blog_categories WHERE slug = 'compliance';"
```

Expected output: one row with slug `compliance`, name `Compliance`. If empty, run:

```bash
cd apps/web
npx tsx scripts/seed-priority-blogs.ts
```

(That existing script will idempotently seed the category if missing. The three priority blog posts it ships with are unrelated to this batch and will not conflict.)

---

## Step 2: Create the seed script for these four blogs

Create `apps/web/scripts/seed-spf-pillar-blogs.ts`:

```bash
cd apps/web
touch scripts/seed-spf-pillar-blogs.ts
```

Populate the script with the structure below. The four blog post bodies should be copy-pasted from the deliverables files (`01-pillar-blog-post.md`, `05-blog-supporting-1-penalty-units.md`, `06-blog-supporting-2-sender-id.md`, `07-blog-supporting-3-five-fines.md`) into the `content` field of each post object. **Strip the frontmatter and implementation notes from each — only the body text goes into `content`.**

```typescript
/**
 * Seed 4 SPF-pillar blog posts: pillar + 3 supporting.
 *
 * Usage: npx tsx apps/web/scripts/seed-spf-pillar-blogs.ts
 *
 * Posts are inserted as status: "draft" initially — review in /admin/blog
 * before flipping to "published". This is intentional: the pillar post
 * is high-visibility and benefits from a final pre-publication read.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ------------------------------------------------------------------
// Post 1: Pillar — Five penalties, one rejected code, sixty-four days
// ------------------------------------------------------------------
const PILLAR_CONTENT = `[paste the full body of 01-pillar-blog-post.md here, starting at "On 7 April 2026..." and ending at the footnoted sources line]`;

// ------------------------------------------------------------------
// Post 2: Supporting 1 — Penalty units explainer
// ------------------------------------------------------------------
const PENALTY_UNITS_CONTENT = `[paste the full body of 05-blog-supporting-1-penalty-units.md]`;

// ------------------------------------------------------------------
// Post 3: Supporting 2 — Sender ID Register
// ------------------------------------------------------------------
const SENDER_ID_CONTENT = `[paste the full body of 06-blog-supporting-2-sender-id.md]`;

// ------------------------------------------------------------------
// Post 4: Supporting 3 — Five fines pattern
// ------------------------------------------------------------------
const FIVE_FINES_CONTENT = `[paste the full body of 07-blog-supporting-3-five-fines.md]`;

const posts = [
  {
    slug: "spf-telco-readiness-1-july-2026",
    title:
      "Five penalties, one rejected code, sixty-four days: Why every Australian telco except Telstra is a buyer of scam intelligence",
    subtitle:
      "Why every Australian telco except Telstra is a buyer, not a builder, of scam intelligence by 1 July 2026.",
    excerpt:
      "Six telco penalties in twelve months. ACMA's draft consumer code rejected twice. SPF Act commences 1 July 2026 with A$52.7M maximum penalties. Here's what changes — and why every Australian telco except Telstra will be a buyer of scam intelligence.",
    content: PILLAR_CONTENT,
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
    hero_image_url: null,
    status: "draft", // Review in /admin/blog before publishing
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
    content: PENALTY_UNITS_CONTENT,
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
    content: SENDER_ID_CONTENT,
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
    content: FIVE_FINES_CONTENT,
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
    hero_image_url: null,
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
  console.log("Seeding 4 SPF-pillar blog posts...\n");

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
      { onConflict: "slug" },
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
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
```

---

## Step 3: Run the seed script

```bash
cd apps/web
npx tsx scripts/seed-spf-pillar-blogs.ts
```

Expected output:

```
Seeding 4 SPF-pillar blog posts...
  OK: "Five penalties, one rejected code, sixty-four days..." (status: draft)
  OK: "What '159,745 penalty units' actually means..." (status: draft)
  OK: "The SMS Sender ID Register goes live in sixty-four days..." (status: draft)
  OK: "Five telcos. Twelve months. One audit finding repeated six times." (status: draft)

Done: 4 posts upserted as drafts.
Review in /admin/blog before flipping to 'published'.
```

---

## Step 4: Review each draft in the admin UI

Open `https://askarthur.au/admin/blog` (or your local dev URL `http://localhost:3000/admin/blog`). For each of the four draft posts:

1. Click into the post.
2. Verify the rendered markdown looks correct — particularly:
   - Tables in the supporting posts render as HTML tables (the `Five telcos` post has a markdown table)
   - Italics on regulator quotes (the pillar post is heavy with italicised quotes from O'Loughlin and Yorke)
   - The blockquote callouts — note that the deliverables do NOT use GitHub admonition syntax (`> [!WARNING]`) because the content tone is editorial rather than instructional. Standard blockquotes (`> "quote"`) are correct.
3. Verify the metadata: SEO title under 70 chars, meta description under 160 chars, tags array populated.
4. **For the pillar post specifically:** verify `is_featured: true` is set so it appears at the top of `/blog`.

---

## Step 5: Publish in sequence

Do NOT publish all four at once. Publish in this order to maximise SEO and social compounding:

**Day 0 (publication day):** Publish the **pillar** (`spf-telco-readiness-1-july-2026`). Same day, post LinkedIn Post 1 from `08-linkedin-series.md` linking to the pillar.

**Day 4:** Post LinkedIn Post 2 (no new blog publish — let the pillar accumulate organic traffic).

**Day 7:** Publish supporting post 3 (`five-telcos-twelve-months-acma-pattern`). It is the most evergreen of the three. Tweet/LinkedIn link from Post 1's comments.

**Day 10:** Publish supporting post 1 (`spf-159745-penalty-units-explained`).

**Day 14:** Publish supporting post 2 (`sms-sender-id-register-cio-guide-2026`). This is the most time-sensitive — it counts down to 1 July.

To publish each: in `/admin/blog`, change `status` from `draft` to `published`. The blog page revalidation (`revalidate = 3600` in `apps/web/app/blog/[slug]/page.tsx`) means the post appears within an hour. Force immediate revalidation by hitting `/api/revalidate` if you have that endpoint configured, or restart the Vercel deployment.

---

## Step 6: Internal linking (do this AFTER publishing)

Each supporting post should link back to the pillar in its first paragraph or first relevant phrase. The pillar should not link out to the supporting posts in its body text (it stands alone), but the AskArthur blog homepage should feature all four in a "SPF Series" cluster if your blog UI supports tag-based clustering.

If your blog system supports related posts (the file `apps/web/lib/blog.ts` has `getRelatedPosts`), confirm that the four posts share enough tags (`spf`, `compliance`, `regulation`, `telcos`) that they appear as related to each other. They will, given the tag overlap above.

---

## Step 7: Sitemap and Search Console

Confirm the four new URLs are in your sitemap (`apps/web/app/sitemap.ts` if it exists, or whatever generates `/sitemap.xml`). Submit each URL to Google Search Console for explicit indexing. The "compliance" category page should also be re-submitted as it has new content.

---

## Step 8: Email and outreach activation

The four posts give you legitimate content hooks for the three outreach emails (`02-email-davidson-idcare.md`, `03-email-chiarelli-tpg.md`, `04-email-walsh-vocus.md`). Do NOT send the outreach emails before the pillar post is published — the emails reference the public asset and benefit from being timestamped _after_ it.

Send the Davidson email Day 1 (after pillar publication).
Send the Chiarelli email Day 8 (after the second LinkedIn post lands).
Send the Walsh email Day 15+ (after IDCARE acknowledges the Davidson letter; the Walsh email is a warm-intro, not a cold).

---

## Verification before launching

- [ ] Pillar word count: 2,500–3,500 (I confirmed 2,980 — within range)
- [ ] Supporting posts: 1,000–1,400 each
- [ ] No `[!WARNING]` / `[!TIP]` / `[!DANGER]` callouts (these are for instructional content, not editorial)
- [ ] All ACMA quotes are verbatim from the verified sources (not paraphrased)
- [ ] All dates are verified per the verification pass: Dodo breach 17 Oct 2025, ATA TCP rejection 27 Mar 2026, Lacey AFCA start 31 Mar 2026, etc.
- [ ] David Lacey's "4,000 referrers vs few hundred funders" quote is verbatim from his LinkedIn post (verified)
- [ ] Charlotte Davidson is referred to as "Group CEO" not "interim Group CEO" (verified)
- [ ] No claims about Vocus / Brisbane City Council formal IDCARE partnerships (not verified — only Dodo-breach-referral relationship is on record)
- [ ] No claims about AISA CyberCon CFP submission (CFP closed 15 April 2026 — too late)
- [ ] No claims about Apate.ai as an AEA grant precedent (Apate is VC-funded, not AEA)
- [ ] All telco employee names mentioned (Chiarelli, Walsh, Singh) are publicly named in linked sources
