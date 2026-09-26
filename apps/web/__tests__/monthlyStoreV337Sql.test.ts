import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * v337 — `targeting_events` (#1084) rides the ONE monthly-store writer, and
 * the months frozen before it stay NULL: not measured, never zero, never
 * back-filled from `clones`.
 *
 * Go-red record (each verified 2026-09-27 by editing v337 and re-running):
 *   - "writes targeting_events": drop `r.targeting_events` from the writer's
 *     SELECT list (keep the INSERT column) → arrives NULL.
 *   - "no backfill": append `UPDATE … SET targeting_events = clones` → the
 *     frozen July rows read 3/2, not NULL.
 *   - "refuses more events than domains": drop the CHECK → the insert succeeds.
 */

const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;

const row = (brand: string, over: Record<string, unknown> = {}) => ({
  brand,
  brand_normalized: brand.split(".")[0],
  is_au: true,
  clones: 9,
  targeting_events: 1,
  reported_to_netcraft: 0,
  likely_phishing: 0,
  parked: 0,
  taken_down: 0,
  declined: 9,
  escalated: 0,
  weaponised: 0,
  deliberate_clones: 0,
  alert_ids: [1],
  new_registered: 9,
  new_deliberate: 0,
  matcher_version: "v5",
  ...over,
});

const write = async (month: string, rows: unknown[], republish = false) =>
  (
    await db.query<{ r: Record<string, unknown> }>(
      "SELECT write_clone_watch_monthly_stats($1::date, $2::jsonb, '[]'::jsonb, $3) AS r",
      [month, JSON.stringify(rows), republish],
    )
  ).rows[0].r;

const events = async (month: string) =>
  Object.fromEntries(
    (
      await db.query<{ brand: string; targeting_events: number | null }>(
        "SELECT brand, targeting_events FROM clone_watch_monthly_brand_stats WHERE period_month = $1",
        [month],
      )
    ).rows.map((r) => [r.brand, r.targeting_events]),
  );

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
  await db.exec(`
    INSERT INTO clone_watch_report_summary VALUES ('2026-07-01', '2026-09-04T05:00:00Z');
    INSERT INTO clone_watch_monthly_brand_stats (period_month, brand, clones, deliberate_clones) VALUES
      ('2026-07-01', 'bonds.com.au', 3, 1),
      ('2026-07-01', 'kmart.com.au', 2, 1);
  `);
  await db.exec(migration("migration-v319-monthly-brand-store-freeze.sql"));
  await db.exec(migration("migration-v325-monthly-store-v2.sql"));
  await db.exec(migration("migration-v337-monthly-store-targeting-events.sql"));
}, 30_000);

afterAll(async () => db?.close());

describe("v337 targeting_events", () => {
  it("no backfill: a month frozen before v5 stays NULL (not measured), not clones, not 0", async () => {
    expect(await events("2026-07-01")).toEqual({ "bonds.com.au": null, "kmart.com.au": null });
  });

  it("writes targeting_events through the one writer", async () => {
    const r = await write("2026-10-01", [row("bonds.com.au"), row("westpac.com.au", { clones: 0, targeting_events: 0 })]);
    expect(r.status).toBe("written");
    expect(await events("2026-10-01")).toEqual({ "bonds.com.au": 1, "westpac.com.au": 0 });
  });

  it("a payload without the key (pre-v5 code) lands NULL — never a fabricated zero", async () => {
    const { targeting_events: _drop, ...legacy } = row("bonds.com.au");
    void _drop;
    await write("2026-11-01", [legacy]);
    expect(await events("2026-11-01")).toEqual({ "bonds.com.au": null });
  });

  it("refuses more events than domains", async () => {
    await expect(
      write("2026-12-01", [row("bonds.com.au", { clones: 2, targeting_events: 3 })]),
    ).rejects.toThrow(/targeting_events_check/);
  });

  it("is idempotent — re-applying changes nothing", async () => {
    await db.exec(migration("migration-v337-monthly-store-targeting-events.sql"));
    expect(await events("2026-10-01")).toEqual({ "bonds.com.au": 1, "westpac.com.au": 0 });
  });
});
