import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { domainCoveredForMonth } from "@/lib/clone-watch/brand-coverage";

/**
 * v325 — monthly store v2, executed against a real Postgres (PGlite): the new
 * columns ride the ONE writer (v319) and its freeze, and the published months
 * are backfilled WITHOUT touching a single existing value.
 *
 * Go-red record (each verified by reverting the named line in v325 and
 * re-running this file):
 *   - "writes the v325 columns": drop `r.active_stock_eom` from the writer's
 *     SELECT list (keep the INSERT column) → the column arrives NULL.
 *   - "the frozen guard still refuses": drop the `IF v_frozen IS NOT NULL AND
 *     NOT …` early return → active_stock_eom 7 → 99.
 *   - "leaves every existing value untouched": add `clones = clones + 0,
 *     frozen_at = now()` to the new_registered backfill → frozen_at moves.
 *   - "coverage_full_month, same rule as the TS producer": drop
 *     `AND NOT j.partial_overlap` → June's servicesaustralia.gov.au (Medicare
 *     joined 16 June) reads fully covered.
 *   - "swept_domains stays NULL … mid-month": drop the `HAVING min(created_at)
 *     < … + 3 days` → July reads 1,000.
 *   - "resets only dead-dormant rows": drop `urlscan_failure_streak >= 8`
 *     from reset_clone_alert_dead_dormancy → the streak-3 row resets.
 */

const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;

const brandRow = (brand: string, over: Record<string, unknown> = {}) => ({
  brand,
  brand_normalized: brand.split(".")[0],
  is_au: true,
  clones: 5,
  reported_to_netcraft: 1,
  likely_phishing: 1,
  parked: 0,
  taken_down: 1,
  declined: 0,
  escalated: 0,
  weaponised: 1,
  deliberate_clones: 4,
  tactic_mix: { top: [], other: 0, unknown: 0, total: 0 },
  intent_mix: { top: [], other: 0, unknown: 0, total: 0 },
  tld_mix: { top: [], other: 0, unknown: 0, total: 0 },
  hosting_mix: { total: 0 },
  clusters: [],
  fingerprinted_clones: 0,
  largest_cluster: 0,
  weaponised_ever: 2,
  weaponised_after_decline: 0,
  re_taken_down: 0,
  taken_down_in_month: 1,
  alert_ids: [11, 12],
  new_registered: 5,
  new_deliberate: 4,
  active_stock_eom: 7,
  stock_by_status: { live: 3, parked: 4, gone: 2 },
  swept_domains: 2_100_000,
  coverage_full_month: true,
  matcher_version: "v4",
  classifier_version: "jev-1.13.0",
  liveness_checked_at: "2026-10-01T01:05:00Z",
  ...over,
});

const write = async (month: string, rows: unknown[], republish = false) =>
  (
    await db.query<{ r: Record<string, unknown> }>(
      "SELECT write_clone_watch_monthly_stats($1::date, $2::jsonb, '[]'::jsonb, $3) AS r",
      [month, JSON.stringify(rows), republish],
    )
  ).rows[0].r;

const stats = async (month: string) =>
  (
    await db.query<Record<string, unknown>>(
      "SELECT * FROM clone_watch_monthly_brand_stats WHERE period_month = $1 ORDER BY brand",
      [month],
    )
  ).rows;

// The v319-era columns — the backfill must not move any of them.
const OLD_COLUMNS =
  "period_month, brand, brand_normalized, is_au, clones, reported_to_netcraft, likely_phishing, parked, taken_down, declined, escalated, weaponised, deliberate_clones, weaponised_ever, weaponised_after_decline, re_taken_down, taken_down_in_month, alert_ids, frozen_at";

let beforeV325: unknown[] = [];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION brand_normalize(p_raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
      SELECT NULLIF(regexp_replace(lower(coalesce(p_raw, '')), '[^a-z0-9]+', '', 'g'), '');
    $$;
    CREATE TABLE shopfront_clone_alerts (
      id bigint PRIMARY KEY, candidate_domain text, inferred_target_domain text,
      target_brand_normalized text, source text DEFAULT 'nrd',
      first_seen_at timestamptz, triage_status text, lifecycle_state text,
      weaponised_at timestamptz, netcraft_declined_at timestamptz, submitted_to jsonb,
      urlscan_uuid text, urlscan_failure_streak int NOT NULL DEFAULT 0, urlscan_evidence jsonb
    );
    CREATE TABLE brand_coverage_history (
      brand text, brand_normalized text NOT NULL, brand_domain text,
      covered_from date, covered_to date
    );
    CREATE TABLE clone_watch_report_summary (
      period_month date PRIMARY KEY, generated_at timestamptz
    );
    CREATE TABLE cost_telemetry (
      id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
      feature text NOT NULL, provider text NOT NULL, operation text NOT NULL,
      units numeric, estimated_cost_usd numeric, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await db.exec(migration("migration-v193-clone-watch-trend-stats.sql"));
  await db.exec(`
    ALTER TABLE clone_watch_monthly_brand_stats
      ADD COLUMN taken_down integer NOT NULL DEFAULT 0,
      ADD COLUMN declined integer NOT NULL DEFAULT 0,
      ADD COLUMN escalated integer NOT NULL DEFAULT 0,
      ADD COLUMN weaponised integer NOT NULL DEFAULT 0;
    ALTER TABLE clone_watch_monthly_registrar_stats
      ADD COLUMN weaponised integer NOT NULL DEFAULT 0,
      ADD COLUMN median_days_to_weaponise real;
  `);
  await db.exec(migration("migration-v296-brand-stats-targeting-intel.sql"));

  // Published months, frozen by v319.
  await db.exec(`
    INSERT INTO clone_watch_report_summary VALUES
      ('2026-07-01', '2026-09-04T05:00:00Z'), ('2026-08-01', '2026-09-04T05:00:00Z');
    INSERT INTO clone_watch_monthly_brand_stats (period_month, brand, clones, deliberate_clones, taken_down, weaponised) VALUES
      ('2026-06-01', 'servicesaustralia.gov.au', 2, 1, 0, 0),
      ('2026-07-01', 'servicesaustralia.gov.au', 3, 2, 0, 0),
      ('2026-07-01', 'hellostake.com', 3, 2, 1, 0),
      ('2026-07-01', 'kmart.com.au', 2, 1, 0, 0),
      ('2026-08-01', 'hellostake.com', 1, 1, 0, 0),
      ('2026-08-01', 'kmart.com.au', 4, 3, 0, 1),
      ('2026-08-01', 'mecca.com.au', 6, 5, 0, 0),
      ('2026-08-01', 'nomatch.com.au', 1, 0, 0, 0);
    -- hellostake: whole of Jul+Aug. kmart: whole of Jul, removed (stamp 1 Sep
    -- = gone by 1 Sep) so August is NOT whole. mecca: added mid-July, so July
    -- partial, August whole. nomatch: no coverage row. servicesaustralia:
    -- Medicare joined the shared domain on 16 June — June is a composition
    -- change even though Services Australia covered the whole month.
    INSERT INTO brand_coverage_history (brand, brand_normalized, brand_domain, covered_from, covered_to) VALUES
      ('Stake', 'stake', 'hellostake.com', '2026-05-26', NULL),
      ('Kmart', 'kmart', 'kmart.com.au', '2026-05-26', '2026-09-01'),
      ('Mecca', 'mecca', 'mecca.com.au', '2026-07-21', NULL),
      ('Services Australia', 'servicesaustralia', 'servicesaustralia.gov.au', '2026-05-26', NULL),
      ('Medicare', 'medicare', 'servicesaustralia.gov.au', '2026-06-16', NULL);
    INSERT INTO cost_telemetry (created_at, feature, provider, operation, metadata) VALUES
      ('2026-08-01T08:30:00Z', 'shopfront_clone_watch', 'whoisds', 'nrd_daily_ingest', '{"domains_scanned": 70000}'),
      ('2026-08-02T08:30:00Z', 'shopfront_clone_watch', 'whoisds', 'nrd_daily_ingest', '{"domains_scanned": 65000}'),
      ('2026-08-03T08:30:00Z', 'shopfront_clone_watch', 'whoisds', 'nrd_daily_ingest', '{"reason": "no_file"}'),
      ('2026-07-15T08:30:00Z', 'shopfront_clone_watch', 'whoisds', 'nrd_daily_ingest', '{"domains_scanned": 1000}'),
      ('2026-08-04T08:30:00Z', 'shopfront_clone_watch', 'whoisds', 'something_else', '{"domains_scanned": 999999}');
    INSERT INTO shopfront_clone_alerts (id, candidate_domain, inferred_target_domain, urlscan_uuid, urlscan_failure_streak, urlscan_evidence, lifecycle_state) VALUES
      (101, 'dead-a.com', 'hellostake.com', NULL, 8, '{"status": "400"}', 'declined'),
      (102, 'dead-b.com', 'hellostake.com', NULL, 12, '{"status": 400}', 'declined'),
      (103, 'young.com', 'hellostake.com', NULL, 3, '{"status": "400"}', 'declined'),
      (104, 'scanned.com', 'hellostake.com', 'abc-uuid', 9, '{"status": "400"}', 'declined'),
      (105, 'other-err.com', 'hellostake.com', NULL, 9, '{"status": "500"}', 'declined');
  `);
  await db.exec(migration("migration-v319-monthly-brand-store-freeze.sql"));
  beforeV325 = (
    await db.query(`SELECT ${OLD_COLUMNS} FROM clone_watch_monthly_brand_stats ORDER BY period_month, brand`)
  ).rows;
  await db.exec(migration("migration-v325-monthly-store-v2.sql"));
}, 30_000);

afterAll(async () => db?.close());

const byBrand = async (month: string) =>
  Object.fromEntries((await stats(month)).map((r) => [r.brand as string, r]));

describe("v325 backfill of the published months", () => {
  it("leaves every existing value untouched, frozen_at included", async () => {
    const after = (
      await db.query(`SELECT ${OLD_COLUMNS} FROM clone_watch_monthly_brand_stats ORDER BY period_month, brand`)
    ).rows;
    expect(after).toEqual(beforeV325);
  });

  it("new_registered = clones, new_deliberate = deliberate_clones", async () => {
    const aug = await byBrand("2026-08-01");
    expect(aug["kmart.com.au"].new_registered).toBe(4);
    expect(aug["kmart.com.au"].new_deliberate).toBe(3);
  });

  it("never invents a stock figure: active_stock_eom / stock_by_status / liveness_checked_at stay NULL", async () => {
    const rows = [...(await stats("2026-07-01")), ...(await stats("2026-08-01"))];
    expect(rows.every((r) => r.active_stock_eom === null)).toBe(true);
    expect(rows.every((r) => r.stock_by_status === null)).toBe(true);
    expect(rows.every((r) => r.liveness_checked_at === null)).toBe(true);
    expect(rows.every((r) => r.classifier_version === null)).toBe(true);
  });

  it("swept_domains sums the month's nrd_daily_ingest domains_scanned (other operations ignored)", async () => {
    const aug = await byBrand("2026-08-01");
    expect(Number(aug["kmart.com.au"].swept_domains)).toBe(135_000);
  });

  it("swept_domains stays NULL for a month whose telemetry starts mid-month (June's real shape)", async () => {
    // July's only ingest row is on the 15th: the sum would be a fraction of
    // the feed, published as the denominator of a frozen month.
    const jul = await byBrand("2026-07-01");
    expect(jul["kmart.com.au"].swept_domains).toBeNull();
  });

  it("coverage_full_month, same rule as the TS producer", async () => {
    const coverage = [
      { brandDomain: "hellostake.com", brandNormalized: "stake", coveredFrom: "2026-05-26", coveredTo: null },
      { brandDomain: "kmart.com.au", brandNormalized: "kmart", coveredFrom: "2026-05-26", coveredTo: "2026-09-01" },
      { brandDomain: "mecca.com.au", brandNormalized: "mecca", coveredFrom: "2026-07-21", coveredTo: null },
      { brandDomain: "servicesaustralia.gov.au", brandNormalized: "servicesaustralia", coveredFrom: "2026-05-26", coveredTo: null },
      { brandDomain: "servicesaustralia.gov.au", brandNormalized: "medicare", coveredFrom: "2026-06-16", coveredTo: null },
    ];
    for (const month of ["2026-06-01", "2026-07-01", "2026-08-01"]) {
      for (const r of await stats(month)) {
        expect(r.coverage_full_month, `${month} ${r.brand}`).toBe(
          domainCoveredForMonth(coverage, r.brand as string, month),
        );
      }
    }
    const aug = await byBrand("2026-08-01");
    expect(aug["hellostake.com"].coverage_full_month).toBe(true);
    expect(aug["kmart.com.au"].coverage_full_month).toBe(false); // gone by 1 Sep
    expect(aug["mecca.com.au"].coverage_full_month).toBe(true);
    expect(aug["nomatch.com.au"].coverage_full_month).toBe(false);
    expect((await byBrand("2026-07-01"))["kmart.com.au"].coverage_full_month).toBe(true);
    // a brand joining a shared domain mid-month is OUR change: not whole
    expect((await byBrand("2026-06-01"))["servicesaustralia.gov.au"].coverage_full_month).toBe(false);
    expect((await byBrand("2026-07-01"))["servicesaustralia.gov.au"].coverage_full_month).toBe(true);
  });

  it("stamps matcher_version v4 on Jun–Aug only", async () => {
    const aug = await byBrand("2026-08-01");
    expect(aug["kmart.com.au"].matcher_version).toBe("v4");
  });

  it("re-applying the migration changes nothing", async () => {
    const before = await db.query("SELECT * FROM clone_watch_monthly_brand_stats ORDER BY period_month, brand");
    await db.exec(migration("migration-v325-monthly-store-v2.sql"));
    const after = await db.query("SELECT * FROM clone_watch_monthly_brand_stats ORDER BY period_month, brand");
    expect(after.rows).toEqual(before.rows);
  });
});

describe("write_clone_watch_monthly_stats — v325 columns through the one writer", () => {
  beforeEach(async () => {
    await db.exec(`
      SELECT set_config('app.clone_watch_republish', 'on', false);
      DELETE FROM clone_watch_monthly_brand_stats WHERE period_month >= '2026-09-01';
      SELECT set_config('app.clone_watch_republish', '', false);
    `);
  });

  it("writes the v325 columns", async () => {
    const r = await write("2026-09-01", [brandRow("a.com.au")]);
    expect(r.status).toBe("written");
    const [row] = await stats("2026-09-01");
    expect(row.new_registered).toBe(5);
    expect(row.new_deliberate).toBe(4);
    expect(row.active_stock_eom).toBe(7);
    expect(row.stock_by_status).toEqual({ live: 3, parked: 4, gone: 2 });
    expect(Number(row.swept_domains)).toBe(2_100_000);
    expect(row.coverage_full_month).toBe(true);
    expect(row.matcher_version).toBe("v4");
    expect(row.classifier_version).toBe("jev-1.13.0");
    expect(new Date(row.liveness_checked_at as string).toISOString()).toBe("2026-10-01T01:05:00.000Z");
  });

  it("persists NULL — not 0 — when there was no snapshot", async () => {
    await write("2026-09-01", [
      brandRow("a.com.au", { active_stock_eom: null, stock_by_status: null, liveness_checked_at: null }),
    ]);
    const [row] = await stats("2026-09-01");
    expect(row.active_stock_eom).toBeNull();
    expect(row.stock_by_status).toBeNull();
  });

  it("writes a zero row (clones 0) like any other", async () => {
    await write("2026-09-01", [brandRow("watched.com.au", { clones: 0, new_registered: 0, alert_ids: [] })]);
    const [row] = await stats("2026-09-01");
    expect(row.clones).toBe(0);
    expect(row.new_registered).toBe(0);
  });

  it("the frozen guard still refuses — including the new columns", async () => {
    await write("2026-09-01", [brandRow("a.com.au", { active_stock_eom: 7 })]);
    const r = await write("2026-09-01", [brandRow("a.com.au", { active_stock_eom: 99 })]);
    expect(r.status).toBe("frozen");
    expect((await stats("2026-09-01"))[0].active_stock_eom).toBe(7);
    await expect(
      db.exec("UPDATE clone_watch_monthly_brand_stats SET active_stock_eom = 1 WHERE period_month = '2026-09-01'"),
    ).rejects.toThrow(/frozen month/);
  });
});

describe("clone_liveness_snapshots", () => {
  it("accepts the stock statuses and rejects anything else", async () => {
    await db.exec(`
      INSERT INTO clone_liveness_snapshots (period_month, alert_id, candidate_domain, brand, status)
      VALUES ('2026-09-01', 1, 'x.com', 'a.com.au', 'no_host');
    `);
    await expect(
      db.exec(`
        INSERT INTO clone_liveness_snapshots (period_month, alert_id, candidate_domain, brand, status)
        VALUES ('2026-09-01', 2, 'y.com', 'a.com.au', 'dead');
      `),
    ).rejects.toThrow();
  });

  it("has RLS on and nothing granted to anon / authenticated", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname = 'clone_liveness_snapshots'",
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const grants = await db.query<{ grantee: string }>(
      "SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'clone_liveness_snapshots' AND grantee IN ('anon', 'authenticated')",
    );
    expect(grants.rows).toEqual([]);
  });
});

describe("clone_liveness_runs", () => {
  it("has RLS on and nothing granted to anon / authenticated", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname = 'clone_liveness_runs'",
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const grants = await db.query<{ grantee: string }>(
      "SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'clone_liveness_runs' AND grantee IN ('anon', 'authenticated')",
    );
    expect(grants.rows).toEqual([]);
  });
});

describe("reset_clone_alert_dead_dormancy", () => {
  it("resets only rows dead-dormant by the v326 rule", async () => {
    const r = await db.query<{ ids: number[] }>(
      "SELECT reset_clone_alert_dead_dormancy(ARRAY[101, 102, 103, 104, 105, 999]::bigint[]) AS ids",
    );
    expect(r.rows[0].ids.map(Number)).toEqual([101, 102]);
    const rows = await db.query<{ id: number; urlscan_failure_streak: number }>(
      "SELECT id, urlscan_failure_streak FROM shopfront_clone_alerts WHERE id BETWEEN 101 AND 105 ORDER BY id",
    );
    expect(rows.rows.map((x) => [Number(x.id), x.urlscan_failure_streak])).toEqual([
      [101, 0],
      [102, 0],
      [103, 3],
      [104, 9],
      [105, 9],
    ]);
  });

  it("returns an empty array for no ids / NULL", async () => {
    const r = await db.query<{ ids: number[] }>("SELECT reset_clone_alert_dead_dormancy(NULL) AS ids");
    expect(r.rows[0].ids).toEqual([]);
  });
});
