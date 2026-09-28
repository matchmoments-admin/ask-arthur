/**
 * The one read of `brand_coverage_history` as `BrandCoverage` rows — the
 * Supabase Adapter beside the pure brand-coverage.ts Module (the ADR-0020
 * shape: pure Module in the library, loader app-side).
 *
 * Three readers need the same rows: the report card (trend gate + the month's
 * monitored-brand count), the public /clone-watch page (today's count) and the
 * monthly blog (the month's count, passed into the prompt). Each would
 * otherwise restate the snake_case → domain mapping and, more importantly, the
 * failure contract:
 *
 *   null — the read FAILED. Not the same as [] (the table is empty). Both mean
 *          "no count", but only one of them is a bug, and collapsing them is
 *          how a degraded read quietly becomes a confident number.
 *
 * The table is ~300 rows (one per brand per coverage window), so a full read
 * is cheaper than a second query shape.
 */
import type { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { BrandCoverage } from "@/lib/clone-watch/brand-coverage";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

export async function readBrandCoverage(
  sb: ServiceClient,
  caller: string,
): Promise<BrandCoverage[] | null> {
  const { data, error } = await sb
    .from("brand_coverage_history")
    .select("brand_normalized, brand_domain, covered_from, covered_to");
  if (error) {
    logger.warn("brand coverage read failed", { caller, error: error.message });
    return null;
  }
  return (data ?? []).map((r) => {
    const row = r as {
      brand_normalized: string;
      brand_domain: string;
      covered_from: string;
      covered_to: string | null;
    };
    return {
      brandDomain: row.brand_domain,
      brandNormalized: row.brand_normalized,
      coveredFrom: row.covered_from,
      coveredTo: row.covered_to,
    };
  });
}
