// Reddit-intel theme detail loader, extracted from
// apps/web/app/intel/themes/[slug]/page.tsx.
//
// React.cache wrap is at this definition site — generateMetadata + the
// default export share one DB round-trip per request. The wrap MUST stay
// here; recreating cache(...) at the callsite would break request-scope
// dedup.

import "server-only";

import { cache } from "react";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ThemeRow {
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

export interface MemberRow {
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

export const loadTheme = cache(async (
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
