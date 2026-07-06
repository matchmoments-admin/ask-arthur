import type { createServiceClient } from "@askarthur/supabase/server";
import type { BrandAliasRecord } from "@askarthur/shopfront-glue";
import { logger } from "@askarthur/utils/logger";

// The Adapter half of the canonical brand-key Seam (see
// docs/plans/brand-convergence-seam.md, Phase 0): the Supabase-backed loader
// that produces the BrandAliasRecord the pure buildBrandResolver runs over.
// Concentrates the paged-load loop previously duplicated verbatim in
// reddit-brands-discover.ts and report-brand-stewardship.ts.

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

/**
 * Bulk-load the v174 `brand_aliases` layer into a plain Record
 * (`alias_normalized` → `canonical_brand`), paging defensively at 1000 rows.
 *
 * Never throws: on a query error it logs and returns whatever loaded so far, so
 * a degraded alias layer only WEAKENS canonicalisation (more brands resolve to
 * null) rather than failing the caller's Inngest step. Call this INSIDE a
 * `step.run` — the returned Record is JSON-serialisable, so it survives Inngest
 * step boundaries; a Map would not.
 *
 * @param logLabel prefix for the error log so the failing caller is identifiable.
 */
export async function loadAliasRecord(
  sb: ServiceClient,
  logLabel = "load-brand-aliases",
): Promise<BrandAliasRecord> {
  const map: BrandAliasRecord = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("brand_aliases")
      .select("alias_normalized, canonical_brand")
      .range(from, from + 999);
    if (error) {
      logger.error(`${logLabel}: brand_aliases load failed`, {
        error: error.message,
      });
      break;
    }
    for (const row of data ?? []) {
      map[row.alias_normalized as string] = row.canonical_brand as string;
    }
    if ((data?.length ?? 0) < 1000) break;
  }
  return map;
}
