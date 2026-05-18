// Server-only data loaders for /scam-feed.
//
// Kept separate from lib/feed.ts because that module exports constants
// (SOURCE_CONFIG, CATEGORY_CONFIG, COUNTRY_FLAGS) that are also imported
// from client components (FeedCard, FeedList, WorldScamMapWithHighlights).
// Adding "server-only" there would break the client bundle.

import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";

export interface PinnedAlert {
  id: number;
  source: string;
  title: string;
  url: string | null;
  published_at: string | null;
  created_at: string;
}

export async function getInitialFeed() {
  const supabase = createServiceClient();
  if (!supabase) {
    return { items: [], total: 0 };
  }

  const { data, count, error } = await supabase
    .from("feed_items")
    .select("*", { count: "exact" })
    .eq("published", true)
    // r/scambait roleplay / image-only posts have no analyzable body and
    // are noise on the consumer feed. Mirror the API filter so SSR and
    // client-fetched pages stay consistent.
    .not("source_url", "ilike", "%/r/scambait/%")
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .range(0, 19);

  if (error) {
    return { items: [], total: 0 };
  }

  return { items: data || [], total: count ?? 0 };
}

export async function getPinnedRegulatorAlerts(): Promise<PinnedAlert[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("feed_items")
    .select("id, source, title, url, published_at, created_at")
    .in("source", ["scamwatch_alert", "acsc", "asic_investor"])
    .eq("published", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(3);
  return (data ?? []) as PinnedAlert[];
}
