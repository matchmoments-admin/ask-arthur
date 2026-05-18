// Public Reddit-intel theme detail page.
//
// Surfaces a single narrative cluster (reddit_intel_themes row) plus the
// contributing Reddit posts that joined it. Acts as the durable deep-link
// target for the weekly intel email and a B2B trial-pitch surface — every
// theme page carries a "Want this monitored for your brand?" CTA.
//
// Accepts either UUID or slug — same precedent as the B2B API route at
// apps/web/app/api/v1/intel/themes/[id]/route.ts:46.

import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { gateOrNotFound } from "@/lib/featureGate";
import { withUtm } from "@/lib/utm";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ slug: string }>;
}

interface ThemeRow {
  id: string;
  slug: string | null;
  title: string;
  narrative: string | null;
  modus_operandi: string | null;
  representative_brands: string[] | null;
  member_count: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

interface MemberRow {
  id: string;
  intent_label: string | null;
  narrative_summary: string | null;
  brands_impersonated: string[] | null;
  processed_at: string | null;
  feed_items: {
    title?: string | null;
    url?: string | null;
    source_url?: string | null;
    source?: string | null;
    source_created_at?: string | null;
  } | null;
}

// Wrapped in React.cache so generateMetadata + the default export share
// one DB round-trip per request instead of two. Cache is request-scoped.
const loadTheme = cache(async (
  key: string,
): Promise<{ theme: ThemeRow; members: MemberRow[] } | null> => {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const lookupCol = UUID_RE.test(key) ? "id" : "slug";
  const { data: theme, error } = await supabase
    .from("reddit_intel_themes")
    .select(
      "id, slug, title, narrative, modus_operandi, representative_brands, member_count, first_seen_at, last_seen_at",
    )
    .eq(lookupCol, key)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    logger.error("intel theme page lookup failed", {
      key,
      error: error.message,
    });
    return null;
  }
  if (!theme) return null;

  const { data: members } = await supabase
    .from("reddit_post_intel")
    .select(
      "id, intent_label, narrative_summary, brands_impersonated, processed_at, feed_items(title, url, source_url, source, source_created_at)",
    )
    .eq("theme_id", (theme as ThemeRow).id)
    .order("processed_at", { ascending: false })
    .limit(50);

  return {
    theme: theme as ThemeRow,
    members: (members ?? []) as unknown as MemberRow[],
  };
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  if (!featureFlags.redditIntelPublicPages) {
    return { title: "Theme — Ask Arthur" };
  }
  const { slug } = await params;
  const result = await loadTheme(slug);
  if (!result) return { title: "Theme not found — Ask Arthur" };

  const desc = (result.theme.narrative ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 155);

  return {
    title: `${result.theme.title} — Ask Arthur Intel`,
    description: desc || `Reddit scam pattern tracked by Ask Arthur.`,
    alternates: {
      canonical: `https://askarthur.au/intel/themes/${result.theme.slug ?? result.theme.id}`,
    },
    openGraph: {
      title: result.theme.title,
      description: desc,
      type: "article",
    },
  };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ThemePage({ params }: PageProps) {
  gateOrNotFound("redditIntelPublicPages");

  const { slug } = await params;
  const result = await loadTheme(slug);
  if (!result) notFound();

  const { theme, members } = result;
  const trialUrl = withUtm("https://askarthur.au/onboarding", {
    source: "intel-theme",
    campaign: "trial",
  });
  const brands = theme.representative_brands ?? [];

  return (
    <article>
      <header className="mb-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Reddit Scam Pattern
        </p>
        <h1 className="text-3xl font-semibold leading-tight text-deep-navy md:text-4xl">
          {theme.title}
        </h1>
        <p className="mt-3 text-xs text-slate-500">
          {theme.member_count ?? members.length} reports
          {theme.first_seen_at && (
            <> · first seen {formatDate(theme.first_seen_at)}</>
          )}
          {theme.last_seen_at && (
            <> · last seen {formatDate(theme.last_seen_at)}</>
          )}
        </p>
      </header>

      {theme.narrative && (
        <p className="mb-6 text-base leading-7 text-slate-700">
          {theme.narrative}
        </p>
      )}

      {theme.modus_operandi && (
        <section className="mb-8 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            How the scam works
          </h2>
          <p className="text-sm leading-6 text-slate-700">
            {theme.modus_operandi}
          </p>
        </section>
      )}

      {brands.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Brands impersonated
          </h2>
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => (
              <span
                key={b}
                className="rounded-full bg-deep-navy/5 px-3 py-1 text-xs text-deep-navy"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-base font-semibold text-deep-navy">
          Member posts on Reddit ({members.length})
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-slate-500">
            No source posts available yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {members.map((m) => {
              const url =
                m.feed_items?.source_url ?? m.feed_items?.url ?? null;
              const postTitle =
                m.feed_items?.title ?? m.narrative_summary ?? "Reddit post";
              return (
                <li key={m.id} className="p-4">
                  <div className="flex flex-col gap-1">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-deep-navy hover:underline"
                      >
                        {postTitle}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-deep-navy">
                        {postTitle}
                      </span>
                    )}
                    {m.narrative_summary &&
                      m.narrative_summary !== postTitle && (
                        <p className="text-xs leading-5 text-slate-600">
                          {m.narrative_summary}
                        </p>
                      )}
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      {m.feed_items?.source ?? "reddit"}
                      {m.feed_items?.source_created_at && (
                        <> · {formatDate(m.feed_items.source_created_at)}</>
                      )}
                      {m.intent_label && <> · {m.intent_label}</>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside className="rounded-xl border border-deep-navy/15 bg-deep-navy/5 p-6">
        <h2 className="text-lg font-semibold text-deep-navy">
          Want this monitored for your brand?
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Ask Arthur tracks scam patterns across Reddit, ACCC Scamwatch and
          consumer reports — and alerts you the moment your brand is named.
          Start a trial to see what&apos;s targeting you.
        </p>
        <Link
          href={trialUrl}
          className="mt-4 inline-flex items-center rounded-lg bg-deep-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-deep-navy/90"
        >
          Start a brand-monitoring trial
        </Link>
      </aside>
    </article>
  );
}
