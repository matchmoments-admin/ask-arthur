import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { featureFlags } from "@askarthur/utils/feature-flags";

import ArthursTake from "@/components/arthurs-take/ArthursTake";
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
  const canonicalSlug = takeSlug(take.feedItemId, take.title);

  return {
    title: `${take.title.slice(0, 70)} — what Arthur sees`,
    description:
      description || "Pattern analysis of a reported scam, by Ask Arthur.",
    alternates: {
      canonical: `https://askarthur.au/scam-feed/${canonicalSlug}`,
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

  // Canonicalise: a bare id, or a stale suffix after a title correction,
  // redirects to the readable form. Resolution is on the leading id, so an
  // already-shared link keeps working rather than 404ing.
  const canonical = takeSlug(take.feedItemId, take.title);
  if (id !== canonical) {
    redirect(`/scam-feed/${canonical}`);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm">
        <Link
          href="/scam-feed"
          className="text-gov-slate underline underline-offset-2 hover:text-deep-navy"
        >
          ← Back to the feed
        </Link>
      </p>

      <article className="mt-6">
        <header>
          <p className="text-xs uppercase tracking-wide text-gov-slate">
            Reported on Reddit
            {take.postedAt ? ` · ${formatDate(take.postedAt)}` : ""}
          </p>
          <h1 className="mt-1 text-2xl font-semibold leading-snug text-deep-navy sm:text-3xl">
            {take.title}
          </h1>
        </header>

        {/* The SAME excerpt the card shows — never body_md. The Reddit terms
            position is that we publish our paraphrase, not the source body,
            and this page must not widen what the feed already shows. */}
        {take.excerpt ? (
          <blockquote className="mt-5 border-l-2 border-slate-200 pl-4 text-sm leading-relaxed text-gov-slate">
            {take.excerpt}
          </blockquote>
        ) : null}

        {/* Attribution is required, not optional — every derived view links to
            the original (reddit-intel-reddit-tos.md §4). */}
        {take.sourceUrl ? (
          <p className="mt-3 text-sm">
            <a
              href={take.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline underline-offset-2 hover:text-deep-navy"
            >
              Read the original report on Reddit ↗
            </a>
          </p>
        ) : null}

        <div className="mt-8">
          <ArthursTake take={take} />
        </div>
      </article>
    </main>
  );
}
