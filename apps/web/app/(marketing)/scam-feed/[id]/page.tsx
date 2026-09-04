import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { featureFlags } from "@askarthur/utils/feature-flags";

import ArthursTake from "@/components/arthurs-take/ArthursTake";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import { gateOrNotFound } from "@/lib/featureGate";
import { loadTake, takeSlug } from "@/lib/arthurs-take/loader";
import { OG_BASE } from "@/lib/og";

// force-dynamic is REQUIRED, not stylistic: gateOrNotFound reads the flag at
// request time, and on a statically prerendered route the gate would be
// evaluated once at build and baked in. Enforced by featureGateRuntime.test.ts.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  // The gate helper cannot run inside metadata, so the flag is re-checked here.
  if (!featureFlags.arthursTakeDetail) {
    return { title: "Scam report — Ask Arthur" };
  }
  const { id } = await params;
  const take = await loadTake(id);
  if (!take) return { title: "Report not found — Ask Arthur" };

  const description = (take.where ?? take.tells[0] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 155);
  return {
    title: `${take.title.slice(0, 70)} — what Arthur sees`,
    description:
      description || "Pattern analysis of a reported scam, by Ask Arthur.",
    alternates: {
      canonical: `https://askarthur.au/scam-feed/${takeSlug(take.feedItemId, take.title)}`,
    },
    // Next replaces the parent openGraph wholesale — spread the base or the
    // page loses the site's card image entirely. See lib/og.ts.
    openGraph: {
      ...OG_BASE,
      title: take.title.slice(0, 70),
      description,
      type: "article",
    },
    // Indexing stays OFF until the accuracy gate passes. A wrong take is
    // public and searchable, and there is no un-indexing a bad one quickly.
    robots: { index: false, follow: false },
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ScamFeedTakePage({ params }: PageProps) {
  gateOrNotFound("arthursTakeDetail");

  const { id } = await params;
  const take = await loadTake(id);
  if (!take) notFound();

  // NO redirect here, deliberately.
  //
  // An earlier version redirected a bare id to the readable slug. On this
  // route that produces a BLANK PAGE: `dynamic = "force-dynamic"` streams the
  // response, metadata has already flushed by the time the body runs, and
  // Next cannot turn a started stream into a 307 — so `redirect()` threw
  // mid-stream and the reader got a title and nothing else. Verified in
  // production: /scam-feed/42353 returned 200 with an empty body while
  // /scam-feed/42353-legal-process-service rendered fine.
  //
  // Every form resolves on the leading id, so a bare id, an old slug, or a
  // slug from before a title correction all render the same page. The
  // preferred URL is advertised by `alternates.canonical` in generateMetadata,
  // which is what search engines and link unfurlers read — and is the correct
  // mechanism for this regardless of the streaming problem.

  return (
    // The marketing shell, per DESIGN_SYSTEM.md § "non-negotiable". The
    // (marketing) route group has NO layout, so each page renders Nav/Footer
    // itself — an earlier version of this page shipped without them, leaving a
    // public page with no site navigation and a dead skip link (root layout
    // links to #main-content).
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16"
      >
        <nav className="text-xs text-slate-400 mb-8">
          <Link
            href="/scam-feed"
            className="hover:text-action-teal transition-colors"
          >
            Feed
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-slate-500">Arthur&rsquo;s Take</span>
        </nav>

        <article>
          <header className="mb-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Reported on Reddit
              {take.postedAt ? ` \u00b7 ${formatDate(take.postedAt)}` : ""}
            </p>
            <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight">
              {take.title}
            </h1>
          </header>

          {/* The SAME excerpt the card shows — never body_md. The Reddit-terms
              position is that we publish our paraphrase, not the source body,
              and this page must not widen what the feed already shows. */}
          {take.excerpt ? (
            <blockquote className="mb-4 border-l-2 border-deep-navy/15 pl-4 text-gov-slate leading-relaxed">
              {take.excerpt}
            </blockquote>
          ) : null}

          {/* Attribution is required, not decoration — every derived view
              links to the original (reddit-intel-reddit-tos.md §4). */}
          {take.sourceUrl ? (
            <p className="mb-10">
              <a
                href={take.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-xs font-medium text-deep-navy underline-offset-2 hover:underline"
              >
                Read the original report on Reddit →
              </a>
            </p>
          ) : null}

          <ArthursTake take={take} />

          <p className="text-sm text-gov-slate mt-10 pt-6 border-t border-deep-navy/10">
            Back to the{" "}
            <Link href="/scam-feed" className="underline">
              scam feed
            </Link>{" "}
            for the latest reports.
          </p>
        </article>
      </main>
      <Footer />
    </div>
  );
}
