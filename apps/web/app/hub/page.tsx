// Ask Arthur hub — the single front door we point a LinkedIn audience at.
//
// WHY THIS IS A ROUTE AND NOT A STATIC FILE: the deck's clone-watch stats are
// its whole claim to authority, and a hardcoded copy of them rots. The draft
// this was ported from shipped 981/130/728 and was already 44/21/117 short by
// the time it landed. Everything volatile here is resolved server-side on a
// 1-hour ISR window, so the page cannot drift from the database again.
//
// Number provenance — quote the RPC, never a remembered figure:
//   candidates / brands / netcraft  → clone_watch_public_impact(p_days => 30)
//   latest edition                  → clone_watch_report_summary (newest row)
//   writing                         → blog_posts via lib/blog.ts getAllPosts()
//
// These are three different windows over the same pipeline (rolling 30-day vs
// calendar-month cohort). They are NOT expected to reconcile with each other,
// and the labels on the page say which is which.

import type { Metadata } from "next";
import { createServiceClient } from "@askarthur/supabase/server";
import { getAllPosts } from "@/lib/blog";
import { blogPostPath } from "@/lib/blogPath";
import { withUtm } from "@/lib/utm";
import Deck from "./Deck";
import type { Chapter } from "./chapters";

export const revalidate = 3600; // 1 hour — matches /clone-watch/[period]

const ORIGIN = "https://askarthur.au";

// The Ask Arthur company page. Same URL the homepage already publishes as the
// organisation's schema.org `sameAs` (app/page.tsx) — taken from there rather
// than guessed, so there is one answer to "which LinkedIn is ours".
//
// Typed `string | null` on purpose: the "Elsewhere" row omits itself when this
// is null, so the deck can never render a dead LinkedIn link. A page whose job
// is teaching people to verify links does not get to serve a broken one.
const LINKEDIN_URL: string | null = "https://www.linkedin.com/company/114874091";

export const metadata: Metadata = {
  title: "Ask Arthur — Check a scam, read the research, watch the clones",
  description:
    "One place for everything Ask Arthur: the free scam scanner, Persona Check, the blog, and the daily clone-watch sweep of lookalike Australian domains.",
  alternates: { canonical: "/hub" },
  openGraph: {
    type: "website",
    url: "/hub",
    title: "Ask Arthur — Check a scam, read the research, watch the clones",
    description:
      "One place for everything Ask Arthur: the free scam scanner, Persona Check, the blog, and the daily clone-watch sweep of lookalike Australian domains.",
  },
  robots: { index: true, follow: true },
};

/* --------------------------------------------------------------------------
   Links
   ----------------------------------------------------------------------- */

// UTM-tag outbound http(s) only. `mailto:` and `tel:` are left alone —
// withUtm() would happily append a query string to a mailto: and produce an
// address nobody can send to.
function linkHref(href: string): string {
  if (!/^https?:/i.test(href)) return href;
  return withUtm(href, { source: "hub", medium: "referral", campaign: "launch" });
}

/* --------------------------------------------------------------------------
   Data
   ----------------------------------------------------------------------- */

interface ImpactSnapshot {
  candidates_total: number;
  brands_protected: number;
  netcraft_submits_total: number;
}

interface EditionRow {
  period_month: string;
  total_domains: number;
  brand_count: number;
}

async function getImpact(): Promise<ImpactSnapshot | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const { data } = await supabase.rpc("clone_watch_public_impact", { p_days: 30 });
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0] as ImpactSnapshot;
}

// Newest durable monthly summary row. Self-advances the "Latest edition" card
// the moment the monthly snapshot lands — no code change, no stale month.
async function getLatestEdition(): Promise<EditionRow | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("clone_watch_report_summary")
    .select("period_month, total_domains, brand_count")
    .order("period_month", { ascending: false })
    .limit(1);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0] as EditionRow;
}

function editionLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-07-01" -> "2026-07", the /clone-watch/[period] slug. */
function editionSlug(periodMonth: string): string {
  return periodMonth.slice(0, 7);
}

const n = (v: number) => v.toLocaleString("en-AU");

/* --------------------------------------------------------------------------
   Writing — curated order, but validated against what is actually published.
   A hand-picked list is the right editorial call for a deck; a hand-picked
   list that never checks itself is how you end up linking an unpublished post.
   Anything missing is dropped and backfilled from the newest posts.
   ----------------------------------------------------------------------- */
const FEATURED_SLUGS = [
  "how-to-check-a-suspicious-email-in-under-a-minute",
  "hellostake-com-has-53-clone-sites-more-than-any-brand-we-watch",
  "2026-04-22-sim-swap-sos-only",
  "how-ask-arthur-works",
  "2026-02-23-why-we-built-ask-arthur",
];
const WRITING_COUNT = 5;

async function getWriting(): Promise<{ title: string; meta: string; href: string }[]> {
  const posts = await getAllPosts(); // published only, newest first
  if (posts.length === 0) return [];
  const bySlug = new Map(posts.map((p) => [p.slug, p]));

  const picked = FEATURED_SLUGS.map((s) => bySlug.get(s)).filter((p) => p !== undefined);
  const pickedSlugs = new Set(picked.map((p) => p.slug));
  for (const p of posts) {
    if (picked.length >= WRITING_COUNT) break;
    if (!pickedSlugs.has(p.slug)) {
      picked.push(p);
      pickedSlugs.add(p.slug);
    }
  }

  return picked.slice(0, WRITING_COUNT).map((p) => ({
    title: p.title,
    meta: `${p.readingTimeMinutes} min`,
    href: linkHref(`${ORIGIN}${blogPostPath(p.slug)}`),
  }));
}

/* --------------------------------------------------------------------------
   Page
   ----------------------------------------------------------------------- */

export default async function HubPage() {
  const [impact, edition, writing] = await Promise.all([
    getImpact(),
    getLatestEdition(),
    getWriting(),
  ]);

  const chapters: Chapter[] = [
    {
      id: "now",
      nav: "Now",
      kind: "hero",
      eyebrow: "Ask Arthur",
      title: "Suspicious message?\nJust ask.",
      lede: (
        <>
          A free AI scam checker for Australia. Paste a message, a link, a phone number or a
          screenshot and get a verdict in seconds. <strong>No signup. Nothing stored.</strong>
        </>
      ),
      meta: ["Independent cybersecurity advisory tool", "Australia"],
      cta: { label: "Check a message", href: linkHref(`${ORIGIN}/`) },
    },

    {
      id: "persona-check",
      nav: "Persona Check",
      kind: "cards",
      eyebrow: "02 · Persona Check",
      title: "Is this person real?",
      lede: "Paste a profile, a message, or just describe what happened. Arthur checks for romance scams, fake recruiters and identity fraud.",
      cta: { label: "Open Persona Check", href: linkHref(`${ORIGIN}/persona-check`) },
      items: [
        {
          title: "Romance / Dating",
          meta: "Someone from a dating app or social media",
          href: linkHref(`${ORIGIN}/persona-check`),
        },
        {
          title: "Job / Recruiter",
          meta: "A recruiter, employer or job offer",
          href: linkHref(`${ORIGIN}/persona-check`),
        },
        {
          title: "Seller or landlord",
          meta: "Anyone you do not fully trust yet",
          href: linkHref(`${ORIGIN}/persona-check`),
        },
        {
          title: "Forward an email",
          meta: "scan@askarthur.au replies in the thread",
          href: "mailto:scan@askarthur.au",
        },
      ],
    },

    {
      id: "writing",
      nav: "Writing",
      kind: "rows",
      eyebrow: "03 · Blog",
      kicker: "Ask Arthur",
      title: "What we write",
      lede: "Scam alerts, security guides and the occasional look under the bonnet. Five to start with — the rest are on the blog.",
      cta: { label: "See all writing", href: linkHref(`${ORIGIN}/blog`) },
      items: writing,
    },

    {
      id: "clone-watch",
      nav: "Clone-watch",
      kind: "panel",
      eyebrow: "04 · Clone-watch",
      kicker: "Daily NRD sweep",
      title: "What we watch",
      lede: "Every day we sweep newly-registered domains for names that mimic Australian brands. Factual observations from a public registry — not accusations.",
      // Null, not zeros. A failed RPC returns no rows with no error, and a
      // confident "0 candidates surfaced" on a page whose entire proposition
      // is "we measure this" is worse than showing nothing.
      stats: impact
        ? [
            { n: n(impact.candidates_total), k: "Candidates surfaced" },
            { n: n(impact.brands_protected), k: "Brands protected" },
            { n: n(impact.netcraft_submits_total), k: "Reported to Netcraft", accent: true },
          ]
        : null,
      statsWindow: "Last 30 days · aggregate only",
      // Deliberately does NOT claim we notify the affected brand:
      // clone_watch_public_impact.brand_notifications_total is 0 — that lane
      // exists in code but has never fired. Do not re-add the claim without
      // checking the column first.
      note: "We never publish which specific domains we report. Reports go to community blocklists so suspect domains get browser-blocked globally.",
      featured: edition
        ? {
            kicker: "Latest edition",
            title: editionLabel(edition.period_month),
            meta: `${n(edition.total_domains)} lookalike domains across ${n(edition.brand_count)} brands`,
            href: linkHref(`${ORIGIN}/clone-watch/${editionSlug(edition.period_month)}`),
          }
        : null,
      cta: { label: "Open clone-watch", href: linkHref(`${ORIGIN}/clone-watch`) },
    },

    {
      id: "elsewhere",
      nav: "Elsewhere",
      kind: "links",
      eyebrow: "05 · Elsewhere",
      title: "Elsewhere",
      lede: "Everywhere else Arthur turns up, and the easiest way to say hello.",
      items: [
        { name: "Scanner", desc: "Check a message right now", href: linkHref(`${ORIGIN}/`) },
        {
          name: "Persona Check",
          desc: "See if someone is who they say",
          href: linkHref(`${ORIGIN}/persona-check`),
        },
        { name: "Blog", desc: "Read what we are seeing", href: linkHref(`${ORIGIN}/blog`) },
        {
          name: "Clone-watch",
          desc: "Watch lookalike domains appear",
          href: linkHref(`${ORIGIN}/clone-watch`),
        },
        {
          name: "Scam feed",
          desc: "Track what is circulating this week",
          href: linkHref(`${ORIGIN}/scam-feed`),
        },
        ...(LINKEDIN_URL
          ? [
              {
                name: "LinkedIn",
                desc: "Connect and stay in touch",
                href: linkHref(LINKEDIN_URL),
              },
            ]
          : []),
        { name: "Email", desc: "Write if you would like to talk", href: "mailto:hello@askarthur.au" },
      ],
      colophon: (
        <>
          Ask Arthur · Australia · © {new Date().getUTCFullYear()} · ABN 72 695 772 313
          <br />
          Independent cybersecurity advisory tool. Not affiliated with the Australian Government.
          <br />
          Scammed? Call <a href="tel:1300292371">1300 CYBER1</a> or report to{" "}
          <a href="https://www.scamwatch.gov.au/report-a-scam">Scamwatch</a>.
        </>
      ),
    },
  ];

  return <Deck chapters={chapters} />;
}
