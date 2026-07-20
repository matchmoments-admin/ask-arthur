import type { MetadataRoute } from "next";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://askarthur.au";

  const staticEntries: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/blog`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/api-docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/contact`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/scam-map`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
    { url: `${baseUrl}/trust`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/scan-channels`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];

  // /scam-feed is gated by featureFlags.scamFeed and 404s while dark — don't
  // advertise it in the sitemap unless the flag is on (a flag-off deploy
  // otherwise points crawlers at a 404). /scam-map has no gate and always
  // renders, so it stays above unconditionally.
  if (featureFlags.scamFeed) {
    staticEntries.push({
      url: `${baseUrl}/scam-feed`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.8,
    });
  }

  // Nothing dynamic to add unless a public-pages flag is on.
  if (!featureFlags.redditIntelPublicPages && !featureFlags.cloneWatchPublic) {
    return staticEntries;
  }

  const supabase = createServiceClient();
  if (!supabase) return staticEntries;

  const dynamicEntries: MetadataRoute.Sitemap = [];

  // Clone Watch owned-media pages — only when the public flag is on (#371).
  if (featureFlags.cloneWatchPublic) {
    dynamicEntries.push(
      { url: `${baseUrl}/clone-watch`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
      { url: `${baseUrl}/clone-watch/method`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    );
    const { data: editions, error: edErr } = await supabase
      .from("clone_watch_report_summary")
      .select("period_month, updated_at")
      .order("period_month", { ascending: false })
      .limit(60);
    if (edErr) {
      logger.warn("sitemap: failed to load clone-watch editions", { error: edErr.message });
    } else {
      for (const e of editions ?? []) {
        const pm = e.period_month as string;
        dynamicEntries.push({
          url: `${baseUrl}/clone-watch/${pm.slice(0, 7)}`,
          lastModified: new Date((e.updated_at as string | null) ?? Date.now()),
          changeFrequency: "monthly",
          priority: 0.7,
        });
      }
    }
  }

  // Reddit Intel theme pages.
  if (featureFlags.redditIntelPublicPages) {
    const { data, error } = await supabase
      .from("reddit_intel_themes")
      .select("slug, last_seen_at, updated_at")
      .eq("is_active", true)
      .not("slug", "is", null)
      .order("last_seen_at", { ascending: false })
      .limit(1000);

    if (error || !data) {
      logger.warn("sitemap: failed to load intel themes", { error: error?.message });
    } else {
      for (const t of data) {
        if (typeof t.slug !== "string" || t.slug.length === 0) continue;
        dynamicEntries.push({
          url: `${baseUrl}/intel/themes/${t.slug}`,
          lastModified: new Date(t.last_seen_at ?? t.updated_at ?? Date.now()),
          changeFrequency: "weekly",
          priority: 0.6,
        });
      }
    }
  }

  return [...staticEntries, ...dynamicEntries];
}
