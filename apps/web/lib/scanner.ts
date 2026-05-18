// Scanner-page data loaders.
//
// Two distinct shapes — kept separate rather than deduped because the
// signatures and merge logic genuinely differ:
//   getCombinedRecentScans  — /health/page.tsx; merges scan_results +
//                             site_audits, sorted by scanned_at desc.
//   getPublicScanFeed       — /health/feed/page.tsx; scan_results only,
//                             public-visibility, last 50.

import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";

export interface RecentScan {
  id: string;
  scan_type: string;
  target: string;
  target_display: string | null;
  grade: string;
  overall_score: number;
  share_token: string | null;
  scanned_at: string;
}

export async function getCombinedRecentScans(): Promise<RecentScan[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const results: RecentScan[] = [];

  // Pull from unified scan_results
  const { data: scanData } = await supabase
    .from("scan_results")
    .select(
      "id, scan_type, target, target_display, grade, overall_score, share_token, scanned_at",
    )
    .eq("visibility", "public")
    .order("scanned_at", { ascending: false })
    .limit(20);

  if (scanData) {
    results.push(...scanData.map((s) => ({ ...s, id: `sr-${s.id}` })));
  }

  // Pull from legacy site_audits (website scans)
  const { data: siteData } = await supabase
    .from("site_audits")
    .select(
      "id, overall_score, grade, scanned_at, share_token, site_id, sites!inner(domain)",
    )
    .order("scanned_at", { ascending: false })
    .limit(20);

  if (siteData) {
    for (const s of siteData) {
      const site = s.sites as unknown as { domain: string };
      results.push({
        id: `sa-${s.id}`,
        scan_type: "website",
        target: site.domain,
        target_display: site.domain,
        grade: s.grade,
        overall_score: s.overall_score,
        share_token: s.share_token,
        scanned_at: s.scanned_at,
      });
    }
  }

  // Sort combined by date, take top 20
  results.sort(
    (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime(),
  );
  return results.slice(0, 20);
}

export async function getPublicScanFeed() {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("scan_results")
    .select(
      "id, scan_type, target, target_display, overall_score, grade, share_token, scanned_at",
    )
    .eq("visibility", "public")
    .order("scanned_at", { ascending: false })
    .limit(50);

  return data || [];
}
