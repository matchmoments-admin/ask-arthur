import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { brandKeyForDomain } from "@/lib/clone-watch/monthly-brand-store";

/**
 * v319 — the monthly per-brand store's freeze, executed against a real
 * Postgres (PGlite), because the freeze is enforced IN SQL: a TS-only guard is
 * exactly what the old delete-then-insert writer bypassed when June–August were
 * all restated on 2026-09-04.
 *
 * Go-red record (each verified by reverting the named line in v319 and
 * re-running this file):
 *   - "refuses a frozen month": drop the `IF v_frozen IS NOT NULL AND NOT
 *     p_republish` early return → the second write overwrites clones 5 → 9.
 *   - "blocks direct writes": make the guard trigger return early → the
 *     DELETE succeeds.
 *   - "leaves the bypass OFF": drop the trailing set_config(…'off') in the
 *     writer → a later DELETE in the same transaction succeeds.
 *   - "backfills taken_down_in_month by event date": drop the takedown_at
 *     window from the join → July's row counts August's takedown.
 *   - "same rule as the TS producer": drop `cs.bn` (single coverage mapping)
 *     from the COALESCE → commbank.com.au reads "cba".
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
  ...over,
});

const write = async (
  month: string,
  rows: unknown[],
  republish = false,
  registrars: unknown[] = [{ registrar: "GoDaddy", clones: 3, weaponised: 1, median_days_to_weaponise: 2.5 }],
) =>
  (
    await db.query<{ r: Record<string, unknown> }>(
      "SELECT write_clone_watch_monthly_stats($1::date, $2::jsonb, $3::jsonb, $4) AS r",
      [month, JSON.stringify(rows), JSON.stringify(registrars), republish],
    )
  ).rows[0].r;

const stats = async (month: string) =>
  (
    await db.query<Record<string, unknown>>(
      "SELECT * FROM clone_watch_monthly_brand_stats WHERE period_month = $1 ORDER BY brand",
      [month],
    )
  ).rows;

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
      weaponised_at timestamptz, netcraft_declined_at timestamptz, submitted_to jsonb
    );
    CREATE TABLE brand_coverage_history (
      brand text, brand_normalized text NOT NULL, brand_domain text,
      covered_from date, covered_to date
    );
    CREATE TABLE clone_watch_report_summary (
      period_month date PRIMARY KEY, generated_at timestamptz
    );
  `);
  await db.exec(migration("migration-v193-clone-watch-trend-stats.sql"));
  // v218 / v231 also touch tables this test does not model; replay only the
  // store columns they add.
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

  // ── Pre-v319 prod shape: three published months written by the old writer.
  await db.exec(`
    INSERT INTO clone_watch_report_summary VALUES
      ('2026-07-01', '2026-09-04T05:00:00Z'), ('2026-08-01', '2026-09-04T05:00:00Z');
    INSERT INTO brand_coverage_history (brand, brand_normalized, brand_domain) VALUES
      ('Services Australia', 'servicesaustralia', 'servicesaustralia.gov.au'),
      ('Medicare', 'medicare', 'servicesaustralia.gov.au'),
      ('Centrelink', 'centrelink', 'servicesaustralia.gov.au'),
      ('Stake', 'stake', 'hellostake.com'),
      ('CommBank', 'commonwealthbank', 'commbank.com.au');
    INSERT INTO clone_watch_monthly_brand_stats (period_month, brand, clones, taken_down, weaponised) VALUES
      ('2026-07-01', 'servicesaustralia.gov.au', 3, 0, 0),
      ('2026-07-01', 'hellostake.com', 2, 2, 0),
      ('2026-07-01', 'kmart.com.au', 2, 0, 0),
      ('2026-07-01', 'commbank.com.au', 1, 0, 0),
      ('2026-08-01', 'hellostake.com', 1, 0, 0),
      ('2026-08-01', 'nomatch.com.au', 1, 0, 0);
    INSERT INTO shopfront_clone_alerts VALUES
      -- servicesaustralia.gov.au: three brands share one domain; majority is medicare
      (1, 'medicare-a.com', 'servicesaustralia.gov.au', 'medicare', 'nrd', '2026-07-03', NULL, 'monitoring', NULL, NULL, NULL),
      (2, 'medicare-b.com', 'servicesaustralia.gov.au', 'medicare', 'nrd', '2026-07-04', NULL, 'monitoring', NULL, NULL, NULL),
      (3, 'sa-c.com', 'servicesaustralia.gov.au', 'servicesaustralia', 'nrd', '2026-07-05', NULL, 'monitoring', NULL, NULL, NULL),
      -- hellostake.com July: weaponised then taken down in AUGUST (event date)
      (4, 'stake-x.com', 'hellostake.com', 'stake', 'nrd', '2026-07-10', NULL, 'taken_down',
         '2026-07-11', NULL, '{"netcraft":{"takedown_at":"2026-08-02 10:00:00+00"},"netcraft_issue":{"issue_reported_at":"2026-07-20"}}'),
      -- taken down, UNDATED: counts in cohort taken_down, never in taken_down_in_month
      (5, 'stake-y.com', 'hellostake.com', 'stake', 'nrd', '2026-07-12', NULL, 'taken_down', NULL, NULL, '{}'),
      -- duplicate candidate row: must not double-count or add a second id
      (6, 'stake-y.com', 'hellostake.com', 'stake', 'nrd', '2026-07-13', NULL, 'taken_down', NULL, NULL, '{}'),
      -- fp-triaged: excluded from membership
      (7, 'stake-fp.com', 'hellostake.com', 'stake', 'nrd', '2026-07-14', 'fp', 'weaponised', '2026-07-15', NULL, NULL),
      -- kmart: alias drift between two keys; the domain label wins
      (8, 'kmart-a.com', 'kmart.com.au', 'kmartaustralia', 'nrd', '2026-07-20', NULL, 'monitoring', NULL, NULL, NULL),
      (9, 'kmart-b.com', 'kmart.com.au', 'kmart', 'nrd', '2026-07-21', NULL, 'monitoring', NULL, NULL, NULL),
      -- commbank: the single coverage mapping beats the alert majority
      (11, 'cba-a.com', 'commbank.com.au', 'cba', 'nrd', '2026-07-22', NULL, 'monitoring', NULL, NULL, NULL),
      -- hellostake August cohort member, weaponised after a decline
      (10, 'stake-z.com', 'hellostake.com', 'stake', 'nrd', '2026-08-05', NULL, 'weaponised', '2026-08-06', '2026-08-05', NULL);
  `);
  await db.exec(migration("migration-v319-monthly-brand-store-freeze.sql"));
}, 30_000);

afterAll(async () => db?.close());

describe("v319 backfill of the published months", () => {
  it("freezes every pre-existing month at the summary's generated_at", async () => {
    const all = await db.query<{ period_month: string; frozen_at: Date }>(
      "SELECT period_month::text, frozen_at FROM clone_watch_monthly_brand_stats",
    );
    expect(all.rows.every((r) => r.frozen_at !== null)).toBe(true);
    const jul = await stats("2026-07-01");
    expect(new Date(jul[0].frozen_at as string).toISOString()).toBe("2026-09-04T05:00:00.000Z");
  });

  it("backfills taken_down_in_month by EVENT date, not first-seen month", async () => {
    const jul = Object.fromEntries((await stats("2026-07-01")).map((r) => [r.brand, r]));
    const aug = Object.fromEntries((await stats("2026-08-01")).map((r) => [r.brand, r]));
    // alert 4 was first seen in July and taken down 2 Aug; alert 5 is undated
    expect(jul["hellostake.com"].taken_down_in_month).toBe(0);
    expect(aug["hellostake.com"].taken_down_in_month).toBe(1);
    // the frozen cohort column is untouched
    expect(jul["hellostake.com"].taken_down).toBe(2);
  });

  it("backfills membership + the stewardship counts, deduped per candidate and fp-free", async () => {
    const jul = Object.fromEntries((await stats("2026-07-01")).map((r) => [r.brand, r]));
    expect(jul["hellostake.com"].alert_ids).toEqual([4, 5]);
    expect(jul["hellostake.com"].weaponised_ever).toBe(1);
    expect(jul["hellostake.com"].re_taken_down).toBe(1);
    const aug = Object.fromEntries((await stats("2026-08-01")).map((r) => [r.brand, r]));
    expect(aug["hellostake.com"].weaponised_after_decline).toBe(1);
  });

  it("backfills brand_normalized with the SAME rule as the TS producer", async () => {
    const rows = (await stats("2026-07-01")).concat(await stats("2026-08-01"));
    const got = Object.fromEntries(rows.map((r) => [`${r.period_month}|${r.brand}`, r.brand_normalized]));
    const coverage = [
      { brandDomain: "servicesaustralia.gov.au", brandNormalized: "servicesaustralia", coveredFrom: "2026-05-01", coveredTo: null },
      { brandDomain: "servicesaustralia.gov.au", brandNormalized: "medicare", coveredFrom: "2026-05-01", coveredTo: null },
      { brandDomain: "servicesaustralia.gov.au", brandNormalized: "centrelink", coveredFrom: "2026-05-01", coveredTo: null },
      { brandDomain: "hellostake.com", brandNormalized: "stake", coveredFrom: "2026-05-01", coveredTo: null },
      { brandDomain: "commbank.com.au", brandNormalized: "commonwealthbank", coveredFrom: "2026-05-01", coveredTo: null },
    ];
    const ts = (domain: string, keys: string[]) => brandKeyForDomain(domain, keys, coverage);
    // shared domain: the owner (label match) beats the medicare majority
    expect(Object.entries(got).find(([k]) => k.endsWith("|servicesaustralia.gov.au"))?.[1]).toBe(
      ts("servicesaustralia.gov.au", ["medicare", "medicare", "servicesaustralia"]),
    );
    expect(ts("servicesaustralia.gov.au", ["medicare", "medicare", "servicesaustralia"])).toBe("servicesaustralia");
    // single coverage mapping wins over the domain label
    expect(Object.entries(got).filter(([k]) => k.endsWith("|hellostake.com")).map(([, v]) => v)).toEqual(["stake", "stake"]);
    expect(ts("hellostake.com", ["stake"])).toBe("stake");
    // alias drift: label match
    expect(Object.entries(got).find(([k]) => k.endsWith("|kmart.com.au"))?.[1]).toBe(ts("kmart.com.au", ["kmartaustralia", "kmart"]));
    // a single coverage mapping beats the alert majority
    expect(Object.entries(got).find(([k]) => k.endsWith("|commbank.com.au"))?.[1]).toBe(ts("commbank.com.au", ["cba"]));
    expect(ts("commbank.com.au", ["cba"])).toBe("commonwealthbank");
    // no alerts, no coverage: the label
    expect(Object.entries(got).find(([k]) => k.endsWith("|nomatch.com.au"))?.[1]).toBe(ts("nomatch.com.au", []));
    expect(ts("nomatch.com.au", [])).toBe("nomatch");
  });

  it("re-applying the migration changes nothing", async () => {
    const before = await db.query("SELECT * FROM clone_watch_monthly_brand_stats ORDER BY period_month, brand");
    await db.exec(migration("migration-v319-monthly-brand-store-freeze.sql"));
    const after = await db.query("SELECT * FROM clone_watch_monthly_brand_stats ORDER BY period_month, brand");
    expect(after.rows).toEqual(before.rows);
  });
});

describe("write_clone_watch_monthly_stats — the one writer", () => {
  beforeEach(async () => {
    await db.exec(`
      SELECT set_config('app.clone_watch_republish', 'on', false);
      DELETE FROM clone_watch_monthly_brand_stats WHERE period_month >= '2026-09-01';
      DELETE FROM clone_watch_monthly_registrar_stats WHERE period_month >= '2026-09-01';
      SELECT set_config('app.clone_watch_republish', '', false);
    `);
  });

  it("writes an unfrozen month atomically and freezes it", async () => {
    const r = await write("2026-09-01", [brandRow("a.com.au"), brandRow("b.com")]);
    expect(r.status).toBe("written");
    expect(r.brand_rows).toBe(2);
    expect(r.registrar_rows).toBe(1);
    const rows = await stats("2026-09-01");
    expect(rows.map((x) => x.brand)).toEqual(["a.com.au", "b.com"]);
    expect(rows.every((x) => x.frozen_at !== null)).toBe(true);
    expect(rows[0].alert_ids).toEqual([11, 12]);
    expect(rows[0].taken_down_in_month).toBe(1);
  });

  it("refuses a frozen month — a re-run cannot restate a published edition", async () => {
    await write("2026-09-01", [brandRow("a.com.au", { clones: 5 })]);
    const frozenAt = (await stats("2026-09-01"))[0].frozen_at;
    const r = await write("2026-09-01", [brandRow("a.com.au", { clones: 9 }), brandRow("new.com")]);
    expect(r.status).toBe("frozen");
    const rows = await stats("2026-09-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].clones).toBe(5);
    expect(rows[0].frozen_at).toEqual(frozenAt);
  });

  it("re-publishes only when asked, and re-stamps frozen_at", async () => {
    await write("2026-09-01", [brandRow("a.com.au", { clones: 5 })]);
    const first = (await stats("2026-09-01"))[0].frozen_at as Date;
    await new Promise((r) => setTimeout(r, 5));
    const r = await write("2026-09-01", [brandRow("a.com.au", { clones: 9 })], true);
    expect(r.status).toBe("republished");
    expect(new Date(r.previous_frozen_at as string).getTime()).toBe(new Date(first).getTime());
    const rows = await stats("2026-09-01");
    expect(rows[0].clones).toBe(9);
    expect(new Date(rows[0].frozen_at as string).getTime()).toBeGreaterThan(new Date(first).getTime());
  });

  it("blocks direct writes to a frozen month (the old delete-then-insert path)", async () => {
    await write("2026-09-01", [brandRow("a.com.au")]);
    await expect(
      db.exec("DELETE FROM clone_watch_monthly_brand_stats WHERE period_month = '2026-09-01'"),
    ).rejects.toThrow(/frozen month/);
    await expect(
      db.exec("UPDATE clone_watch_monthly_brand_stats SET clones = 1 WHERE period_month = '2026-09-01'"),
    ).rejects.toThrow(/frozen month/);
    await expect(
      db.exec("INSERT INTO clone_watch_monthly_brand_stats (period_month, brand) VALUES ('2026-09-01', 'x.com')"),
    ).rejects.toThrow(/frozen month/);
    expect(await stats("2026-09-01")).toHaveLength(1);
  });

  it("leaves the republish bypass OFF for the rest of the caller's transaction", async () => {
    // Autocommit would expire the transaction-local setting anyway, so this
    // only means something inside one transaction: a later direct write in the
    // same transaction must still hit the freeze.
    await expect(
      db.transaction(async (tx) => {
        await tx.query("SELECT write_clone_watch_monthly_stats('2026-09-01'::date, $1::jsonb, '[]'::jsonb, false)", [
          JSON.stringify([brandRow("a.com.au")]),
        ]);
        await tx.query("DELETE FROM clone_watch_monthly_brand_stats WHERE period_month = '2026-09-01'");
      }),
    ).rejects.toThrow(/frozen month/);
  });

  it("rolls the whole month back when any part of the write fails", async () => {
    await write("2026-10-01", [brandRow("a.com.au", { clones: 5 })]);
    await expect(
      write("2026-10-01", [brandRow("a.com.au", { clones: 9 })], true, [{ registrar: null, clones: 1 }]),
    ).rejects.toThrow();
    const rows = await stats("2026-10-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].clones).toBe(5);
  });

  it("rejects a period that is not a month start", async () => {
    await expect(write("2026-09-15", [brandRow("a.com.au")])).rejects.toThrow(/month start/);
  });
});
