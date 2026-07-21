/**
 * One-time script to seed the two Checkout-Guardrail / AI-copytrading consumer
 * education posts (PR-C1) as DRAFTS. Generic (no brand-specific claims — pending
 * the founder legal gate Q5), Stop-Check-Protect framing, real AU report links.
 *
 * Usage: npx tsx apps/web/scripts/seed-copytrading-safety-blogs.ts
 *
 * Posts are inserted as status: "draft" — invisible on the public site (blog.ts
 * filters .eq("status","published")) until reviewed + published at /admin/blog.
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

interface SeedPost {
  slug: string;
  title: string;
  seo_title: string;
  meta_description: string;
  excerpt: string;
  content: string;
  category_slug: string;
  tags: string[];
  reading_time_minutes: number;
}

const posts: SeedPost[] = [
  {
    slug: "shopping-safely-from-google-results",
    title: "Shopping safely from Google results: spot a fake storefront before you pay",
    seo_title: "Shopping Safely from Google Results: Spot Fake Storefronts (2026)",
    meta_description:
      "How to avoid fake online storefronts reached via Google Shopping and Sponsored ads: check the exact domain, pay with a card you can reverse, and spot the skimmer 'error' red flag.",
    excerpt:
      "That 'Sponsored' result isn't always what it looks like. Here's how to shop from search results without handing your card to a fake storefront.",
    category_slug: "guides",
    tags: ["online-shopping", "fake-stores", "google-ads", "card-skimming", "australia"],
    reading_time_minutes: 5,
    content: `That "Sponsored" result at the top of a Google search for a popular product isn't always what it looks like. Scammers rent or hijack advertiser accounts and stand up convincing lookalike storefronts — often a near-copy of a real brand's site on a slightly different web address — to harvest your card details at the checkout. By the time many people notice the address is wrong, they've already typed in their card number.

Here's how to shop from search results without getting caught, using the same **Stop · Check · Protect** habit that works for every scam.

## Stop: slow down at the "Sponsored" line

The results marked **Sponsored** or **Ad** are paid placements. Legitimate retailers use them too — but so do scammers, and Google can't catch every bad ad before it's served. A cheap deal on a hard-to-find item, pushed at the very top of the page, is exactly the bait a fake storefront uses.

The simplest defence: **scroll past the sponsored results** to the first organic (unpaid) result, or better still, **type the brand's web address directly** into your browser if you already know it. You lose ten seconds and skip the riskiest link on the page.

## Check: read the web address like an inspector

Before you enter a single detail, look hard at the address in your browser's bar — not the pretty page, the actual URL. Fake stores rely on you not looking. Watch for:

- **Extra words or hyphens** — \`brandname-outlet-sale.shop\` instead of the real \`brandname.com\`.
- **A different ending (TLD)** — a well-known brand suddenly on \`.shop\`, \`.top\`, \`.store\` or \`.us.com\` rather than the \`.com\` or \`.com.au\` it normally uses.
- **Look-alike letters** — a swapped or doubled character your eye glides over, or an address starting with \`xn--\` (a sign of disguised foreign characters).
- **A brand-new site pretending to be established** — no real contact details, no ABN, stock photos, and reviews that all sound the same.

> [!WARNING]
> A padlock in the address bar means the connection is encrypted. It does **not** mean the store is honest — scam sites get padlocks too.

## Check: pay in a way you can claw back

How you pay decides whether you can get your money back if it goes wrong:

- **Credit card** gives you chargeback rights — the strongest protection. Prefer it for unfamiliar stores.
- **Debit card** pulls straight from your bank account and is harder to reverse.
- **Bank transfer, PayID, or crypto** to a "store" you don't know is the biggest red flag of all. A genuine retailer does not ask you to bank-transfer for a normal online order.

## The skimmer red flag: an "error" right after you enter your card

One trick deserves its own warning. On some compromised or fake checkouts, you enter your full card details, hit pay, and get a **"payment failed — please try again"** message. What actually happened is that your details were captured, and you're now being nudged to enter them a second time.

If a checkout throws an error **immediately after** you've typed your card number, treat it as a skimmer until proven otherwise: **stop, don't re-enter anything, and call your bank** using the number on the back of your card.

## Protect: report it so the next person is warned

If you spot a fake storefront — or you've been caught by one:

- **Report the scam** to the National Anti-Scam Centre's **Scamwatch** at [scamwatch.gov.au](https://www.scamwatch.gov.au/).
- **Call your bank or card issuer immediately** if you entered payment details — speed matters for a chargeback or card block.
- **Report the ad or listing to Google** using the "Report an ad" option so the placement can be pulled.
- **Not sure if a shop is legit?** Paste the web address into Ask Arthur before you pay — we check the domain's age, reputation, and whether it's a look-alike of a known brand.

Ten seconds of checking the address is cheaper than a cancelled card and a fortnight of disputes. Scroll past the ad, type the domain you trust, and pay with something you can reverse.

*Ask Arthur is a free, privacy-first scam checker for Australians. This article is general information, not financial advice.*`,
  },
  {
    slug: "fake-ai-copytrading-withdrawal-block-scams",
    title: "Fake AI copytrading scams: the 'deposit accepted, withdrawal blocked' trap",
    seo_title: "Fake AI Copytrading Scams: Withdrawal-Block Red Flags (2026)",
    meta_description:
      "How fake AI copytrading and investment-bot platforms trap Australians: fake profits, blocked withdrawals, endless 'fees'. The red flags, and how to check ASIC's list before you deposit.",
    excerpt:
      "Deposit accepted, dashboard climbing, withdrawal blocked behind endless 'fees'. Here's how to spot a fake AI copytrading platform before you put money in.",
    category_slug: "scam-alerts",
    tags: ["investment-scam", "copytrading", "crypto-scam", "asic", "australia"],
    reading_time_minutes: 6,
    content: `A slick app promises an AI trading bot that turns a small deposit into daily profit — "guaranteed," "just copy the expert." You put in a little, the dashboard climbs, and for a while it feels real. Then you try to withdraw, and everything changes: a "tax," a "fee," a frozen account, a support agent who keeps moving the goalposts. The profits were never real, and the money you deposited is gone.

These fake AI copytrading and "investment platform" scams are among the fastest-growing frauds targeting Australians, and they're deliberately built to look like the real thing. Here's how to recognise one **before** you deposit — using **Stop · Check · Protect**.

## How the trap works

The mechanics are consistent across these schemes:

1. **The hook** — an ad, a DM, a comment, or a short video showing screenshots of huge gains from an "AI bot" or a "copy-trading expert." Often it name-drops crypto, gold, or forex, and sometimes uses AI-generated "celebrity endorsements" that were never given.
2. **The onboarding** — you're guided to a polished app, told to deposit (often in crypto or by bank transfer) and to "let the bot trade" or "copy" a top performer.
3. **The fake climb** — the dashboard shows steady profits. This is a display, not a market. Nothing is actually being traded.
4. **The block** — when you try to withdraw, the excuses start: a "withdrawal tax," a "verification fee," an account freeze for "cross-market abuse." Each fee is designed to extract more money. **Paying it never releases the funds.**

## The red flags — any one of these should stop you

- **Guaranteed or fixed returns.** No legitimate investment guarantees profit. "AI" doesn't change that — it's often just "AI washing" to make a scam sound cutting-edge.
- **You have to pay a fee or "tax" to withdraw your own money.** This is the single clearest sign of a scam. Real platforms deduct fees from your balance; they never demand a new deposit to unlock a withdrawal.
- **Pressure and urgency** — a limited window, a "VIP group," a mentor messaging you daily to add more.
- **Recruited through social media or a stranger's DM**, then moved to a private chat or an app you'd never heard of.
- **Crypto or bank transfer only.** Hard-to-reverse payment rails are the scammer's friend.
- **It spreads through people you trust.** Victims are encouraged to bring in friends and family, so the "opportunity" often reaches you from someone who genuinely believes it. Their enthusiasm is not evidence it's real.

## Check before you deposit — two free, decisive checks

Before sending a cent, do these:

1. **Search ASIC's Investor Alert List.** ASIC (the Australian Securities & Investments Commission) publishes a public list of companies and websites it has flagged as unlicensed, impersonating, or fraudulent. If the platform — or one of its many aliases — is on it, walk away. Find it via ASIC Moneysmart's [check and report scams](https://moneysmart.gov.au/check-and-report-scams) pages.
2. **Check the licence.** To offer financial services to Australians, a business generally needs an Australian Financial Services (AFS) licence. Search **ASIC Connect's Professional Registers** for the exact company name. No licence — or a name that almost-but-not-quite matches a licensed firm — is a red flag.

If you're unsure, paste the platform's name, link, or a screenshot into Ask Arthur and we'll cross-check it against ASIC's list and known-scam intelligence.

## Protect: if you've already deposited

Act quickly — recovery odds fall with time:

- **Stop all payments immediately.** Do not pay any "fee" or "tax" to release funds — that is the scam continuing. Anyone promising to recover your money for an upfront fee is a **second** scam.
- **Contact your bank or crypto exchange now.** They may be able to freeze or trace a recent transfer.
- **Report it:** [Scamwatch](https://www.scamwatch.gov.au/) (National Anti-Scam Centre), **ASIC** (so the platform can be added to the alert list and taken down), and [ReportCyber](https://www.cyber.gov.au/report) (police).
- **Get support.** Being scammed is not your fault — these schemes are engineered by professionals. [IDCARE](https://www.idcare.org/) offers free help for Australians dealing with identity and financial loss.

The rule that defeats this entire class of scam is simple: **a real investment never asks you to pay a fee to withdraw your own money.** The moment you see that, you're not looking at returns — you're looking at the trap.

*Ask Arthur is a free, privacy-first scam checker for Australians. This article is general information, not financial or investment advice.*`,
  },
];

async function ensureCategoryExists(slug: string): Promise<void> {
  const { data } = await supabase
    .from("blog_categories")
    .select("slug")
    .eq("slug", slug)
    .single();

  if (!data) {
    const name = slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    await supabase.from("blog_categories").insert({
      name,
      slug,
      description: `${name} articles`,
      sort_order: 99,
    });
    console.log(`Created category: ${slug}`);
  }
}

async function main() {
  console.log("Seeding copytrading / shopping-safety blog posts...\n");

  const categories = [...new Set(posts.map((p) => p.category_slug))];
  for (const cat of categories) {
    await ensureCategoryExists(cat);
  }

  let inserted = 0;
  let skipped = 0;

  for (const post of posts) {
    const { data: existing } = await supabase
      .from("blog_posts")
      .select("slug")
      .eq("slug", post.slug)
      .single();

    if (existing) {
      console.log(`  SKIP: "${post.title}" (slug already exists)`);
      skipped++;
      continue;
    }

    const { error } = await supabase.from("blog_posts").insert({
      slug: post.slug,
      title: post.title,
      seo_title: post.seo_title,
      meta_description: post.meta_description,
      excerpt: post.excerpt,
      content: post.content,
      category_slug: post.category_slug,
      tags: post.tags,
      reading_time_minutes: post.reading_time_minutes,
      status: "draft",
      author: "Ask Arthur",
    });

    if (error) {
      console.error(`  ERROR inserting "${post.title}":`, error.message);
    } else {
      console.log(`  OK: "${post.title}"`);
      inserted++;
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);
  console.log("Posts were inserted as drafts. Review and publish at /admin/blog");
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
