import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  AU_BRAND_WATCHLIST,
  brandNormalize,
  buildBrandResolver,
  type BrandAliasRecord,
} from "@askarthur/shopfront-glue";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { loadAliasRecord } from "@/lib/brand-aliases";
import { aggregateBrandMentions } from "./reddit-brands-discover";

/**
 * Brand Register refresh — the "brand 360" rollup (Phase 3 of
 * docs/plans/brand-convergence-seam.md).
 *
 * Nightly, rebuilds public.brand_register: one row per canonical brand carrying
 * the 30-day cross-stream picture (reported-scams + Reddit-intel + open clone
 * alerts), whether it's on the AU watchlist, and its watchlist-candidate
 * curation status — all keyed on the canonical brand-alias layer (v174). This
 * is the convergence artifact that aligns the three brand streams into one
 * queryable identity for the /admin/brand-register surface.
 *
 * Pure read-side derivation: every stream read is a bounded 30-day windowed
 * aggregate; the write is a single atomic replace_brand_register() call (upsert
 * + delete-stale, empty-batch-guarded so a failed aggregation can't wipe the
 * table). Well under the 5-min Inngest budget. Gated by FF_BRAND_REGISTER
 * (default OFF) — when OFF the cron no-ops. No paid API → no cost brake.
 */

const WINDOW_DAYS = 30;

export interface StreamBrand {
  brandNormalized: string;
  rawBrand: string;
  count: number;
}

export interface RegisterRow {
  canonical_brand: string;
  display_name: string;
  on_au_watchlist: boolean;
  scam_30d: number;
  reddit_30d: number;
  clone_open_alerts: number;
  curation_status: string | null;
  cross_stream_priority: number;
}

/**
 * Roll the three streams up into one row per canonical brand. Pure + unit-
 * tested. Every input brand resolves to its canonical via `resolve` (the v174
 * alias layer), falling back to its own raw string when unrecognised, so a
 * brand seen as "NAB"/"nab"/"National Australia Bank" collapses to one row.
 *
 * cross_stream_priority = scam*3 + clone*2 + reddit*1 — an additive ordering
 * hint, never blended into any clone severity.
 */
export function rollupBrandRegister(inputs: {
  watchlistBrands: string[];
  scam: StreamBrand[];
  reddit: StreamBrand[];
  cloneByNormalized: Map<string, number>;
  candidateStatusByNormalized: Map<string, string>;
  resolve: (raw: string) => string | null;
}): RegisterRow[] {
  const {
    watchlistBrands,
    scam,
    reddit,
    cloneByNormalized,
    candidateStatusByNormalized,
    resolve,
  } = inputs;

  const watchedCanonical = new Set(watchlistBrands);
  const rows = new Map<string, RegisterRow>();

  const ensure = (canonical: string, display: string): RegisterRow | null => {
    if (!canonical) return null;
    let row = rows.get(canonical);
    if (!row) {
      row = {
        canonical_brand: canonical,
        display_name: display || canonical,
        on_au_watchlist: watchedCanonical.has(canonical),
        scam_30d: 0,
        reddit_30d: 0,
        clone_open_alerts: 0,
        curation_status: null,
        cross_stream_priority: 0,
      };
      rows.set(canonical, row);
    }
    return row;
  };

  // 1. Seed every watchlist brand (canonical display names) so the register is
  //    the full platform brand list — zero-activity brands still get a row.
  for (const brand of watchlistBrands) ensure(brand, brand);

  // 2. Fold each stream in, resolving to canonical.
  const canonicalFor = (token: string, rawDisplay: string) => {
    const canonical = resolve(token) ?? rawDisplay;
    return { canonical, display: resolve(token) ?? rawDisplay };
  };

  for (const s of scam) {
    const { canonical, display } = canonicalFor(s.rawBrand, s.rawBrand);
    const row = ensure(canonical, display);
    if (row) row.scam_30d += s.count;
  }
  for (const r of reddit) {
    const { canonical, display } = canonicalFor(r.rawBrand, r.rawBrand);
    const row = ensure(canonical, display);
    if (row) row.reddit_30d += r.count;
  }
  for (const [normalized, count] of cloneByNormalized) {
    const { canonical, display } = canonicalFor(normalized, normalized);
    const row = ensure(canonical, display);
    if (row) row.clone_open_alerts += count;
  }

  // 3. Attach curation status + compute the additive priority.
  for (const row of rows.values()) {
    const key = brandNormalize(row.canonical_brand);
    if (key) {
      row.curation_status =
        candidateStatusByNormalized.get(key) ?? row.curation_status;
    }
    row.cross_stream_priority =
      row.scam_30d * 3 + row.clone_open_alerts * 2 + row.reddit_30d * 1;
  }

  return [...rows.values()];
}

export const brandRegisterRefresh = inngest.createFunction(
  {
    id: "brand-register-refresh",
    name: "Brand Register: nightly brand-360 rollup",
    // ADR-0019 fleet conventions: finite finish-timeout + singleton-skip so a
    // slow tick can't occupy an Inngest slot or stack overlapping runs. Daily
    // cadence + concurrency 1 keeps it well clear of the analyze fan-out budget.
    timeouts: { finish: "5m" },
    retries: 1,
    concurrency: { limit: 1 },
    singleton: { mode: "skip" },
  },
  [
    { cron: "30 3 * * *" }, // daily 03:30 UTC
    { event: "brand-register/refresh.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "brand-register-refresh" }, async ({ step }) => {
    if (!featureFlags.brandRegister) {
      return { skipped: true, reason: "flag_off" };
    }

    const since = new Date(
      Date.now() - WINDOW_DAYS * 24 * 3600 * 1000,
    ).toISOString();

    const aliasPairs = await step.run("load-brand-aliases", async () => {
      const sb = createServiceClient();
      if (!sb) return {} as BrandAliasRecord;
      return loadAliasRecord(sb, "brand-register-refresh");
    });
    const resolve = buildBrandResolver(aliasPairs);

    // Reported-scams (windowed, indexed aggregate over the hot table).
    const scam = await step.run("aggregate-scam", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as StreamBrand[];
      const { data, error } = await sb.rpc("aggregate_scam_report_brands", {
        p_since: since,
        p_min_count: 1,
      });
      if (error) {
        logger.error("brand-register: scam aggregate failed", {
          error: error.message,
        });
        return [] as StreamBrand[];
      }
      const rows = (data ?? []) as Array<{
        brand_normalized: string;
        raw_brand: string;
        mention_count: number;
      }>;
      return rows.map((r) => ({
        brandNormalized: r.brand_normalized,
        rawBrand: r.raw_brand,
        count: r.mention_count,
      }));
    });

    // Reddit-intel (30-day window; GIN-backed brands_impersonated).
    const reddit = await step.run("aggregate-reddit", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as StreamBrand[];
      const { data, error } = await sb
        .from("reddit_post_intel")
        .select("brands_impersonated")
        .gt("processed_at", since);
      if (error) {
        logger.error("brand-register: reddit aggregate failed", {
          error: error.message,
        });
        return [] as StreamBrand[];
      }
      const agg = aggregateBrandMentions(data ?? []);
      return [...agg.values()].map((c) => ({
        brandNormalized: c.brandNormalized,
        rawBrand: c.rawBrand,
        count: c.mentionCount,
      }));
    });

    // Open clone alerts, grouped by the sibling brand key (v197).
    const cloneEntries = await step.run("aggregate-clone", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as Array<[string, number]>;
      const { data, error } = await sb.rpc(
        "aggregate_open_clone_alerts_by_brand",
      );
      if (error) {
        logger.error("brand-register: clone aggregate failed", {
          error: error.message,
        });
        return [] as Array<[string, number]>;
      }
      const rows = (data ?? []) as Array<{
        target_brand_normalized: string;
        open_count: number;
      }>;
      return rows.map(
        (r) => [r.target_brand_normalized, r.open_count] as [string, number],
      );
    });

    // Watchlist-candidate curation status per normalized brand.
    const candidateEntries = await step.run("load-candidate-status", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as Array<[string, string]>;
      const out: Array<[string, string]> = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("reddit_watchlist_candidates")
          .select("brand_normalized, status")
          .range(from, from + 999);
        if (error) {
          logger.warn("brand-register: candidate-status load failed", {
            error: error.message,
          });
          break;
        }
        for (const r of data ?? [])
          out.push([r.brand_normalized as string, r.status as string]);
        if ((data?.length ?? 0) < 1000) break;
      }
      return out;
    });

    const rows = rollupBrandRegister({
      watchlistBrands: AU_BRAND_WATCHLIST.map((b) => b.brand),
      scam,
      reddit,
      cloneByNormalized: new Map(cloneEntries),
      candidateStatusByNormalized: new Map(candidateEntries),
      resolve,
    });

    const registerSize = await step.run("replace-register", async () => {
      const sb = createServiceClient();
      if (!sb) return 0;
      const { data, error } = await sb.rpc("replace_brand_register", {
        p_rows: rows,
      });
      if (error) {
        logger.error("brand-register: replace failed", { error: error.message });
        return 0;
      }
      return (data as number) ?? 0;
    });

    logger.info("brand-register-refresh: complete", {
      computed: rows.length,
      registerSize,
      scam: scam.length,
      reddit: reddit.length,
      clone: cloneEntries.length,
    });
    return {
      ok: true,
      computed: rows.length,
      registerSize,
    };
  }),
);
