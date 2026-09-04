import "server-only";

import { cache } from "react";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { parseFeedItemId } from "@/lib/feed";

import type { IntentLabel } from "@askarthur/types";

// Re-exported for server callers that already import them from here. The
// definitions live in lib/feed.ts because FeedCard is a client component and
// cannot import a "server-only" module.
export { takeSlug, parseFeedItemId } from "@/lib/feed";

/**
 * Loader for the Arthur's Take detail page.
 *
 * `cache()` is applied HERE, at the definition, not at the call site: the page
 * body and generateMetadata both call it, and a per-callsite wrap would defeat
 * request-scope dedup and double every query. Same rule as lib/intel/themes.ts.
 *
 * Reads `reddit_post_intel` through the service client because that table is
 * service-role only by design (v82) — there is no anon policy and there should
 * not be one. Never throws: a failed read renders as "not found" rather than a
 * 500, since a public page should not surface a database error.
 */

export interface TakeDetail {
  feedItemId: number;
  intentLabel: IntentLabel;
  confidence: number;
  tells: string[];
  where: string | null;
  auLine: string | null;
  isScamReport: boolean | null;
  countryHints: string[];
  brandsImpersonated: string[];
  writtenAt: string | null;
  /** The source post — excerpt only, never body_md. */
  title: string;
  excerpt: string | null;
  sourceUrl: string | null;
  postedAt: string | null;
  /** Related pattern, when clustering has assigned one and it has a name. */
  themeSlug: string | null;
  themeTitle: string | null;
}

/**
 * The substance bar for having a page at all.
 *
 * Not every ready take earns a URL. A take with one thin tell is a worse
 * advert for the analysis than no page: six thousand near-duplicate pages of
 * three bullets is a search liability, and it undercuts the "this is a serious
 * analytical corpus" impression the page exists to create. Two tells and
 * reasonable confidence is the floor.
 *
 * Exported because the sitemap must enumerate exactly the same set — if the
 * two ever disagree, the sitemap advertises 404s.
 */
export const TAKE_PAGE_MIN_TELLS = 2;
export const TAKE_PAGE_MIN_CONFIDENCE = 0.7;

export function takeIsPageWorthy(row: {
  takeStatus: string | null;
  tells: string[] | null;
  confidence: number | null;
}): boolean {
  return (
    row.takeStatus === "ready" &&
    (row.tells?.length ?? 0) >= TAKE_PAGE_MIN_TELLS &&
    (row.confidence ?? 0) >= TAKE_PAGE_MIN_CONFIDENCE
  );
}

export const loadTake = cache(
  async (slug: string): Promise<TakeDetail | null> => {
    const feedItemId = parseFeedItemId(slug);
    if (feedItemId === null) return null;

    const supabase = createServiceClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from("reddit_post_intel")
      .select(
        // Explicit columns. body_md is deliberately absent: this page renders
        // the same excerpt the card does, per the Reddit-terms position on not
        // republishing full post bodies.
        //
        // The theme embed MUST name its constraint. Two FK paths exist between
        // reddit_post_intel and reddit_intel_themes — the direct theme_id, and
        // the reddit_post_intel_themes join table — so an unqualified embed
        // fails with "more than one relationship was found". That error is
        // caught and logged, and the loader returns null, so the page rendered
        // a perfectly clean "Report not found" for every take. Nothing in
        // typecheck, lint or the unit tests could see it: it is a runtime
        // PostgREST resolution, and only a request against real data shows it.
        "feed_item_id, intent_label, confidence, take_status, take_tells, take_where, take_au_line, take_written_at, is_scam_report, country_hints, brands_impersonated, reddit_intel_themes!reddit_post_intel_theme_id_fkey(slug, title), feed_items(title, description, source_url, source_created_at, published, source)",
      )
      .eq("feed_item_id", feedItemId)
      .maybeSingle();

    if (error) {
      logger.error("arthurs-take loader failed", {
        feedItemId,
        error: error.message,
      });
      return null;
    }
    if (!data) return null;

    const item = data.feed_items as unknown as {
      title: string | null;
      description: string | null;
      source_url: string | null;
      source_created_at: string | null;
      published: boolean | null;
      source: string | null;
    } | null;

    // Reddit only, and only while the source row is still published — an
    // unpublished feed item must not stay reachable through a take URL.
    if (!item || item.published !== true || item.source !== "reddit") {
      return null;
    }

    const tells = (data.take_tells as string[] | null) ?? [];
    if (
      !takeIsPageWorthy({
        takeStatus: data.take_status as string | null,
        tells,
        confidence: Number(data.confidence),
      })
    ) {
      return null;
    }

    const theme = data.reddit_intel_themes as unknown as {
      slug: string | null;
      title: string | null;
    } | null;

    return {
      feedItemId: data.feed_item_id as number,
      intentLabel: data.intent_label as IntentLabel,
      confidence: Number(data.confidence),
      tells,
      where: data.take_where as string | null,
      auLine: data.take_au_line as string | null,
      isScamReport: (data.is_scam_report as boolean | null) ?? null,
      countryHints: (data.country_hints as string[]) ?? [],
      brandsImpersonated: (data.brands_impersonated as string[]) ?? [],
      writtenAt: data.take_written_at as string | null,
      title: item.title ?? "Scam report",
      excerpt: item.description,
      sourceUrl: item.source_url,
      postedAt: item.source_created_at,
      // "Pending naming" is the clusterer's placeholder for a theme too small
      // to have been named; linking to it would be a dead end.
      themeSlug: theme?.title && theme.title !== "Pending naming" ? theme.slug : null,
      themeTitle: theme?.title && theme.title !== "Pending naming" ? theme.title : null,
    };
  },
);
