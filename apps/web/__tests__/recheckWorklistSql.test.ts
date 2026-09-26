import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Runs the REAL recheck worklist SQL (worklist-gate-starvation rule: an
// exclusion must be counted, and the rows it keeps must still rotate). The
// migrations load in order and v330 LAST, so every case below runs against the
// CURRENT body (v330 = v328 + the not-a-clone audit cadence). Go-red
// (2026-09-26): loading v330 with its dead-dormancy predicate removed failed
// "holds out a never-scanned 400 row with streak >= 8, and counts it".
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE shopfront_clone_alerts (
      id bigint PRIMARY KEY, candidate_domain text, candidate_url text,
      source text DEFAULT 'nrd', lifecycle_state text DEFAULT 'declined',
      urlscan_classification text, urlscan_uuid text, urlscan_evidence jsonb,
      urlscan_failure_streak integer DEFAULT 0, recheck_count integer DEFAULT 0,
      last_rechecked_at timestamptz, first_seen_at timestamptz DEFAULT now(),
      signals jsonb, attribution jsonb, inferred_target_domain text,
      -- v330 (read by its recheck clock + audit state function)
      urlscan_scanned_at timestamptz, urlscan_submitted_at timestamptz,
      triage_status text, weaponised_at timestamptz, evidence jsonb,
      updated_at timestamptz
    );
    CREATE TABLE clone_watch_classifications (
      alert_id bigint PRIMARY KEY, is_clone boolean, confidence real, attack_intent text,
      clone_tactic text, model_id text, classified_at timestamptz
    );
    CREATE TABLE known_brands (brand_domain text, brand_category text);
    CREATE TABLE clone_watch_scan_transitions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, alert_id bigint NOT NULL,
      new_classification text NOT NULL, scanned_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.exec(migration("migration-v326-recheck-dead-dormancy-and-age-taper.sql"));
  // v328 re-creates the worklist with due_total — the body every case below
  // now runs against (v326's predicates, unchanged).
  await db.exec(migration("migration-v328-recheck-due-total.sql"));
  // v330 re-creates it again (audit cadence); loaded LAST so it is the body
  // under test. It also creates clone_watch_not_a_clone_samples, which it reads.
  await db.exec(migration("migration-v330-clone-not-a-clone-audit-sample.sql"));
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () => db.exec("DELETE FROM shopfront_clone_alerts"));

type Row = {
  id: number;
  uuid?: string | null;
  streak?: number;
  status?: string | null;
  ageDays?: number;
  lastHoursAgo?: number | null;
  recheckCount?: number;
};
async function insert(r: Row) {
  await db.query(
    `INSERT INTO shopfront_clone_alerts
       (id, candidate_domain, urlscan_uuid, urlscan_failure_streak, urlscan_evidence,
        first_seen_at, last_rechecked_at, recheck_count)
     VALUES ($1, $2, $3, $4, $5::jsonb,
       now() - make_interval(days => $6::int),
       CASE WHEN $7::int IS NULL THEN NULL ELSE now() - make_interval(hours => $7::int) END,
       $8)`,
    [
      r.id,
      `d${r.id}.example`,
      r.uuid ?? null,
      r.streak ?? 0,
      r.status ? JSON.stringify({ status: r.status }) : null,
      r.ageDays ?? 1,
      r.lastHoursAgo ?? null,
      r.recheckCount ?? 0,
    ],
  );
}
const due = async () =>
  (await db.query<{ id: number }>("SELECT id FROM list_clone_alerts_for_recheck(500, 6, 168)"))
    .rows.map((r) => Number(r.id));
const dormant = async () =>
  (await db.query<{ n: number }>("SELECT count_clone_recheck_dormant_dead() AS n")).rows[0]!.n;

describe("v326 recheck worklist", () => {
  it("holds out a never-scanned 400 row with streak >= 8, and counts it", async () => {
    await insert({ id: 1, uuid: null, streak: 8, status: "400" });
    await insert({ id: 2, uuid: null, streak: 7, status: "400" }); // still inside the window
    expect(await due()).toEqual([2]);
    expect(await dormant()).toBe(1);
  });

  it("never holds out a row that has a scan uuid, a non-400 or a NULL status", async () => {
    await insert({ id: 1, uuid: "scan-1", streak: 12, status: "400" });
    await insert({ id: 2, uuid: null, streak: 12, status: "429" });
    await insert({ id: 3, uuid: null, streak: 12, status: null }); // no evidence at all
    expect((await due()).sort()).toEqual([1, 2, 3]);
    expect(await dormant()).toBe(0);
  });

  it("tapers rows older than 45 days to daily, keeps young rows at 6 h", async () => {
    await insert({ id: 1, ageDays: 60, lastHoursAgo: 12 }); // old, rechecked 12h ago → not due
    await insert({ id: 2, ageDays: 60, lastHoursAgo: 30 }); // old, 30h ago → due
    await insert({ id: 3, ageDays: 10, lastHoursAgo: 12 }); // young, 12h ago → due
    expect((await due()).sort()).toEqual([2, 3]);
  });

  it("keeps the dead (168h) and v317 backoff precedence over the taper", async () => {
    await insert({ id: 1, ageDays: 60, lastHoursAgo: 30, status: "400", streak: 2 }); // dead cadence → not due
    await insert({ id: 2, ageDays: 60, lastHoursAgo: 30, recheckCount: 9 }); // weekly → not due
    expect(await due()).toEqual([]);
  });

  it("rotation: a held-out row does not block the rest of the pool", async () => {
    for (let i = 1; i <= 5; i++) await insert({ id: i, uuid: null, streak: 20, status: "400" });
    await insert({ id: 6 });
    expect(await due()).toEqual([6]);
    expect(await dormant()).toBe(5);
  });
});

describe("v328 due_total", () => {
  it("reports every due row, not just the LIMITed page", async () => {
    for (let i = 1; i <= 7; i++) await insert({ id: i });
    await insert({ id: 8, uuid: null, streak: 9, status: "400" }); // dead-dormant: not due
    const r = await db.query<{ id: number; due_total: number }>(
      "SELECT id, due_total FROM list_clone_alerts_for_recheck(3, 6, 168)",
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((x) => Number(x.due_total) === 7)).toBe(true);
  });
});
