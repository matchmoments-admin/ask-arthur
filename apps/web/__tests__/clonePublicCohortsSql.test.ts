import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Runs the REAL v340 SQL against PGlite: the three RPCs behind the public
 * /clone-watch impact panel count the populations the page names.
 *
 *   - "n=X of Y weaponised in window" (blocklistTile, takedown-stats.ts):
 *     X = detect_to_block_n, Y = weaponised_n. X must be a subset of Y.
 *   - every published figure is over CONFIRMED lookalikes (tp_confirmed /
 *     tp_actioned), the rows the page's list shows.
 *   - "Brand-name matches" excludes rows cleared as false positives, and the
 *     Netcraft count is drawn from the same rows so its bar is a subset too.
 *
 * GO-RED (each verified by reverting the named line in the migration, running
 * this file, seeing the named test fail, and restoring):
 *   - `AND blk.weaponised_at >= w.since` removed from `detect` →
 *     "a clone weaponised before the window is not in X" fails (X=1, Y=0) and
 *     the X ≤ Y property fails.
 *   - `AND sca.triage_status IN (...)` removed from `confirmed` →
 *     "an unconfirmed weaponised row is in no takedown figure" fails.
 *   - the triage predicate removed from the vendor-gap `legs` CTE →
 *     "an unconfirmed re-filed row is not in the re-file leg" fails.
 *   - `AND sca.triage_status IS DISTINCT FROM 'fp'` removed from
 *     public_impact → "a cleared false positive is not a brand-name match"
 *     fails (3, not 2).
 */

const migration = readFileSync(
  new URL("../../../supabase/migration-v340-clone-watch-public-cohorts.sql", import.meta.url),
  "utf8",
);

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE shopfront_clone_alerts (
      id bigint PRIMARY KEY,
      source text DEFAULT 'nrd',
      inferred_target_domain text DEFAULT 'brand.com.au',
      first_seen_at timestamptz DEFAULT now(),
      triage_status text DEFAULT 'tp_actioned',
      lifecycle_state text DEFAULT 'weaponised',
      submitted_to jsonb,
      weaponised_at timestamptz,
      netcraft_declined_at timestamptz,
      offline_since timestamptz
    );
  `);
  await db.exec(migration);
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () => db.exec("DELETE FROM shopfront_clone_alerts"));

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

async function insert(row: {
  id: number;
  triage?: string | null;
  lifecycle?: string;
  firstSeenDaysAgo?: number;
  weaponisedDaysAgo?: number | null;
  submittedTo?: unknown;
}) {
  await db.query(
    `INSERT INTO shopfront_clone_alerts
       (id, triage_status, lifecycle_state, first_seen_at, weaponised_at, submitted_to)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      row.id,
      row.triage === undefined ? "tp_actioned" : row.triage,
      row.lifecycle ?? "weaponised",
      ago(row.firstSeenDaysAgo ?? 1),
      row.weaponisedDaysAgo == null ? null : ago(row.weaponisedDaysAgo),
      row.submittedTo === undefined ? null : JSON.stringify(row.submittedTo),
    ],
  );
}

/** A Netcraft malicious classification dated `daysAgo`, on its own clock. */
const blocked = (daysAgo: number) => ({
  netcraft: {
    submitted_at: ago(daysAgo + 0.5),
    takedown_at: ago(daysAgo),
    takedown_at_source: "netcraft_log",
  },
});

const one = async (sql: string) =>
  (await db.query<Record<string, unknown>>(sql)).rows[0]!;
const n = (v: unknown) => Number(v);

describe("clone_watch_takedown_stats — n=X of Y is a true subset (v340)", () => {
  it("a clone weaponised before the window is not in X", async () => {
    // Weaponised 40 days ago, blocklisted 10 days ago: its blocklisting is in
    // the 30-day window, its detection is not, so it is not in Y either.
    await insert({ id: 1, lifecycle: "taken_down", weaponisedDaysAgo: 40, submittedTo: blocked(10) });
    const s = await one("SELECT * FROM clone_watch_takedown_stats(30)");
    expect(n(s.takedowns_total)).toBe(1); // still a blocklisting in the window
    expect(n(s.weaponised_n)).toBe(0);
    expect(n(s.detect_to_block_n)).toBe(0);
  });

  it("X ≤ Y across a mixed window (the property the tile's label asserts)", async () => {
    await insert({ id: 1, lifecycle: "taken_down", weaponisedDaysAgo: 40, submittedTo: blocked(10) });
    await insert({ id: 2, lifecycle: "taken_down", weaponisedDaysAgo: 5, submittedTo: blocked(4) });
    await insert({ id: 3, lifecycle: "taken_down", weaponisedDaysAgo: 60, submittedTo: blocked(2) });
    await insert({ id: 4, lifecycle: "weaponised", weaponisedDaysAgo: 3 });
    const s = await one("SELECT * FROM clone_watch_takedown_stats(30)");
    expect(n(s.detect_to_block_n)).toBeLessThanOrEqual(n(s.weaponised_n));
    expect(n(s.detect_to_block_n)).toBe(1); // only id 2
    expect(n(s.weaponised_n)).toBe(2); // ids 2 and 4
    expect(n(s.weaponised_blocklisted)).toBe(1);
  });

  it("an unconfirmed weaponised row is in no takedown figure", async () => {
    await insert({ id: 1, triage: "pending", lifecycle: "taken_down", weaponisedDaysAgo: 5, submittedTo: blocked(4) });
    await insert({ id: 2, triage: "needs_investigation", weaponisedDaysAgo: 5 });
    await insert({ id: 3, triage: null, weaponisedDaysAgo: 5 });
    await insert({ id: 4, triage: "tp_confirmed", weaponisedDaysAgo: 5 });
    const s = await one("SELECT * FROM clone_watch_takedown_stats(30)");
    expect(n(s.takedowns_total)).toBe(0);
    expect(n(s.detect_to_block_n)).toBe(0);
    expect(n(s.weaponised_n)).toBe(1); // only the tp_confirmed row
  });
});

describe("clone_watch_vendor_gap_stats — confirmed rows only (v340)", () => {
  it("an unconfirmed re-filed row is not in the re-file leg", async () => {
    const refiled = { netcraft_issue: { issue_reported_at: ago(2) } };
    await insert({ id: 1, weaponisedDaysAgo: 3, submittedTo: refiled });
    await insert({ id: 2, triage: "pending", weaponisedDaysAgo: 3, submittedTo: refiled });
    await insert({ id: 3, triage: "needs_investigation", weaponisedDaysAgo: 3, submittedTo: refiled });
    const s = await one("SELECT * FROM clone_watch_vendor_gap_stats(90)");
    expect(n(s.weaponise_to_refile_n)).toBe(1);
  });

  it("still returns exactly one row when nothing qualifies", async () => {
    await insert({ id: 1, triage: "fp", weaponisedDaysAgo: 3 });
    const r = await db.query("SELECT * FROM clone_watch_vendor_gap_stats(90)");
    expect(r.rows).toHaveLength(1);
    expect(n(r.rows[0]!["weaponise_to_refile_n" as never])).toBe(0);
  });
});

describe("clone_watch_public_impact — brand-name matches exclude cleared false positives (v340)", () => {
  it("a cleared false positive is not a brand-name match, and the Netcraft bar is a subset", async () => {
    await insert({ id: 1, triage: null, lifecycle: "detected" });
    await insert({ id: 2, triage: "pending", lifecycle: "detected", submittedTo: { netcraft: { submitted_at: ago(1) } } });
    // Cleared as a false positive AFTER we had reported it: in neither count.
    await insert({ id: 3, triage: "fp", lifecycle: "detected", submittedTo: { netcraft: { submitted_at: ago(1) } } });
    // Outside the window.
    await insert({ id: 4, triage: "pending", lifecycle: "detected", firstSeenDaysAgo: 45 });
    const s = await one("SELECT * FROM clone_watch_public_impact(30)");
    expect(n(s.candidates_total)).toBe(2);
    expect(n(s.netcraft_submits_total)).toBe(1);
    expect(n(s.netcraft_submits_total)).toBeLessThanOrEqual(n(s.candidates_total));
  });
});
