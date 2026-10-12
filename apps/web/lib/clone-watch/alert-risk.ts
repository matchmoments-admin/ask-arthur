/**
 * Weaponisation risk OF AN ALERT ROW — the input assembly for the ONE formula
 * (weaponisation-risk.ts). Both callers hand over the row exactly as they read
 * it plus a {@link BrandCategoryLookup}; this module does every column → input
 * mapping, so the recheck ranking and the Brand Stewardship "highest-risk
 * lookalikes" score the same alert identically by construction (#1298).
 *
 * Why it exists: the two callers assembled the inputs by hand and drifted.
 * The recheck lane omitted `first_seen_at`, so the attribution reader's
 * parent-zone guard never ran there (appley.eu.cc ranked as a domain
 * registered in 1997 — the date of eu.cc — while stewardship called it
 * unknown-age: 26 of the 467 rows in the recheck pool on 2026-10-13). And the
 * brand category came from two resolvers: a SQL `LIMIT 1` with no ORDER BY
 * (which may return the NULL-category twin of the 11 brand domains that have
 * two known_brands rows) versus a first-non-null Map built in arbitrary order.
 *
 * The formula module stays zero-import; this one owns the data-shaped half.
 */
import type { createServiceClient } from "@askarthur/supabase/server";
import { attributionRiskInputs } from "@/lib/clone-watch/attribution";
import {
  computeWeaponisationRisk,
  type WeaponisationRisk,
} from "@/lib/clone-watch/weaponisation-risk";

/** brand_domain → brand_category, resolved by {@link brandCategoryLookup}. */
export type BrandCategoryLookup = ReadonlyMap<string, string>;

export interface KnownBrandCategoryRow {
  id: number;
  brand_domain: string | null;
  brand_category: string | null;
}

/**
 * The ONE category rule: per brand_domain, the non-null brand_category of the
 * LOWEST known_brands.id. Order-independent (input order never matters), and
 * a NULL-category row can never shadow a categorised twin — prod has 11
 * domains with one categorised and one NULL row (commbank, ato, binance, …)
 * and none with two different categories (measured 2026-10-13).
 * v344's SQL (list_clone_alerts_for_recheck.brand_category) mirrors this rule
 * for the deploy window only; scoring reads this lookup.
 */
export function brandCategoryLookup(
  rows: readonly KnownBrandCategoryRow[],
): BrandCategoryLookup {
  const best = new Map<string, { id: number; category: string }>();
  for (const r of rows) {
    if (!r.brand_domain || !r.brand_category) continue;
    const cur = best.get(r.brand_domain);
    if (!cur || r.id < cur.id) {
      best.set(r.brand_domain, { id: r.id, category: r.brand_category });
    }
  }
  return new Map([...best].map(([domain, v]) => [domain, v.category]));
}

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

/** Read known_brands (~300 rows; NULLs are skipped by the rule) into the lookup. Throws on a failed read —
 *  an empty lookup would silently drop every category's points, which is a
 *  ranking change that reads as health. */
export async function loadBrandCategoryLookup(
  sb: ServiceClient,
): Promise<BrandCategoryLookup> {
  const { data, error } = await sb
    .from("known_brands")
    .select("id, brand_domain, brand_category");
  if (error) throw new Error(`known_brands category read: ${error.message}`);
  return brandCategoryLookup((data ?? []) as KnownBrandCategoryRow[]);
}

/**
 * An alert as either caller reads it. The classification arrives in one of two
 * shapes — the PostgREST embed (clone cohort, CLONE_COHORT_SELECT) or the flat
 * `clf_*` columns of list_clone_alerts_for_recheck — and is read from
 * whichever is present, so neither caller maps fields by hand.
 */
export interface RiskAlertRow {
  urlscan_classification: string | null;
  signals?: unknown;
  attribution: unknown;
  first_seen_at?: string | null;
  inferred_target_domain?: string | null;
  clone_watch_classifications?: {
    is_clone: boolean | null;
    confidence: number | null;
    attack_intent: string | null;
  } | null;
  clf_is_clone?: boolean | null;
  clf_confidence?: number | null;
  clf_attack_intent?: string | null;
  /**
   * Deploy-window fallback ONLY: the recheck RPC's pre-resolved category,
   * used when the row carries no `inferred_target_domain` key at all (the
   * RPC before v344). Delete once v344 is applied everywhere.
   */
  brand_category?: string | null;
}

function categoryOf(
  row: RiskAlertRow,
  categories: BrandCategoryLookup,
): string | null {
  if (row.inferred_target_domain === undefined) return row.brand_category ?? null;
  return row.inferred_target_domain
    ? (categories.get(row.inferred_target_domain) ?? null)
    : null;
}

/** Score one alert row. Pure given `nowMs`; never throws. */
export function scoreAlertRisk(
  row: RiskAlertRow,
  categories: BrandCategoryLookup,
  nowMs: number,
): WeaponisationRisk {
  const clf = row.clone_watch_classifications;
  const embedded = clf !== undefined;
  return computeWeaponisationRisk({
    urlscanClassification: row.urlscan_classification,
    signals: row.signals ?? null,
    isClone: (embedded ? clf?.is_clone : row.clf_is_clone) ?? null,
    confidence: (embedded ? clf?.confidence : row.clf_confidence) ?? null,
    attackIntent: (embedded ? clf?.attack_intent : row.clf_attack_intent) ?? null,
    brandCategory: categoryOf(row, categories),
    ...attributionRiskInputs(row.attribution, {
      firstSeenAt: row.first_seen_at ?? null,
    }),
    nowMs,
  });
}
