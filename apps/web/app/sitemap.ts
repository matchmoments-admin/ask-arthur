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
    { url: `${baseUrl}/scam-feed`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.8 },
    { url: `${baseUrl}/scam-map`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
    { url: `${baseUrl}/trust`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/scan-channels`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];

  if (!featureFlags.redditIntelPublicPages) {
    return staticEntries;
  }

  const supabase = createServiceClient();
  if (!supabase) return staticEntries;

  const { data, error } = await supabase
    .from("reddit_intel_themes")
    .select("slug, last_seen_at, updated_at")
    .eq("is_active", true)
    .not("slug", "is", null)
    .order("last_seen_at", { ascending: false })
    .limit(1000);

  if (error || !data) {
    logger.warn("sitemap: failed to load intel themes", { error: error?.message });
    return staticEntries;
  }

  const themeEntries: MetadataRoute.Sitemap = data
    .filter((t): t is { slug: string; last_seen_at: string | null; updated_at: string | null } =>
      typeof t.slug === "string" && t.slug.length > 0,
    )
    .map((t) => ({
      url: `${baseUrl}/intel/themes/${t.slug}`,
      lastModified: new Date(t.last_seen_at ?? t.updated_at ?? Date.now()),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));

  return [...staticEntries, ...themeEntries];
}
