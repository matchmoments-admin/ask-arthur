// Site-audit lookup by domain, extracted from
// apps/web/app/report/[domain]/page.tsx.
//
// React.cache wrap is at this definition site — generateMetadata + the
// default export share one site + audit round-trip per request. The wrap
// MUST stay here; recreating cache(...) at the callsite would break
// request-scope dedup.

import "server-only";

import { cache } from "react";
import { createServiceClient } from "@askarthur/supabase/server";

export const getLatestAuditByDomain = cache(async (domain: string) => {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id, domain, normalized_url")
    .eq("domain", domain)
    .single();

  if (siteError || !site) return null;

  const { data: audit, error: auditError } = await supabase
    .from("site_audits")
    .select(
      "id, overall_score, grade, test_results, category_scores, recommendations, duration_ms, scanned_at, share_token",
    )
    .eq("site_id", site.id)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .single();

  if (auditError || !audit) return null;

  return { site, audit };
});
