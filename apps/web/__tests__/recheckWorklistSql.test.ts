import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Runs the REAL recheck worklist SQL (worklist-gate-starvation rule: an
// exclusion must be counted, and the rows it keeps must still rotate). The
// migrations load in order and v334 LAST, so every case below runs against the
// CURRENT body (v334 = v330's branches + the DNS-gate queue clock). Go-red
// (2026-09-26): loading v330 with its dead-dormancy predicate removed failed
// "holds out a never-scanned 400 row with streak >= 8, and counts it".
//
// v334 go-reds (2026-09-27), each against an edited migration, then reverted:
//   - queue clock without recheck_dns_checked_at (the v330 clock alone) failed
//     "a DNS stamp moves a due row back in the queue …";
//   - `SET recheck_dns_fingerprint = x.fp` (no COALESCE) failed "an
//     inconclusive read keeps the previous baseline";
//   - `LEAST(p_limit, 500)` failed "clamps the fetch at 1,000, not 500".
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
  await db.exec(migration("migration-v331-clone-watch-batch-writes.sql"));
  // v334 re-creates the worklist with the DNS-gate queue clock and adds
  // record_clone_recheck_dns; loaded LAST so it is the body under test.
  await db.exec(migration("migration-v334-recheck-dns-change-gate.sql"));
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

describe("v334 DNS gate", () => {
  const state = async (id: number) =>
    (await db.query<{
      recheck_count: number;
      last_rechecked_at: string | null;
      recheck_dns_fingerprint: string | null;
      recheck_dns_checked_at: string | null;
    }>(
      `SELECT recheck_count, last_rechecked_at, recheck_dns_fingerprint, recheck_dns_checked_at
       FROM shopfront_clone_alerts WHERE id = $1`,
      [id],
    )).rows[0]!;
  const record = (unchanged: number[], scanned: { id: number; fp: string | null }[]) =>
    db.query<{ unchanged_stamped: number; fingerprints_written: number }>(
      "SELECT * FROM record_clone_recheck_dns($1::bigint[], $2::jsonb)",
      [unchanged, JSON.stringify(scanned)],
    );

  it("a DNS stamp moves a due row back in the queue and touches nothing else", async () => {
    await insert({ id: 1, lastHoursAgo: 12, recheckCount: 3 }); // young, 6 h cadence → due
    await insert({ id: 2, lastHoursAgo: 12 });
    expect((await due()).sort()).toEqual([1, 2]);
    const before = await state(1);
    const r = await record([1], []);
    expect(r.rows[0]).toMatchObject({ unchanged_stamped: 1, fingerprints_written: 0 });
    expect(await due()).toEqual([2]);
    const after = await state(1);
    // The urlscan clock and count are NOT moved by a DNS read.
    expect(after.recheck_count).toBe(3);
    expect(after.last_rechecked_at).toEqual(before.last_rechecked_at);
    expect(after.recheck_dns_fingerprint).toBeNull();
    expect(after.recheck_dns_checked_at).not.toBeNull();
  });

  it("an OLDER DNS stamp never hides a row (GREATEST, not the DNS clock alone)", async () => {
    await insert({ id: 1, lastHoursAgo: 30 });
    await db.exec(
      "UPDATE shopfront_clone_alerts SET recheck_dns_checked_at = now() - interval '40 hours' WHERE id = 1",
    );
    expect(await due()).toEqual([1]);
    // A never-checked row (both clocks NULL) is due and leads.
    await insert({ id: 2, lastHoursAgo: null });
    expect(await due()).toEqual([2, 1]);
  });

  it("orders by the queue clock: a DNS-stamped row goes behind an unstamped one", async () => {
    await insert({ id: 1, lastHoursAgo: 40 });
    await insert({ id: 2, lastHoursAgo: 20 });
    expect(await due()).toEqual([1, 2]);
    await db.exec(
      "UPDATE shopfront_clone_alerts SET recheck_dns_checked_at = now() - interval '10 hours' WHERE id = 1",
    );
    expect(await due()).toEqual([2, 1]);
  });

  it("returns the gate inputs, with queue_clock_at = the later of the two clocks", async () => {
    await insert({ id: 1, lastHoursAgo: 30 });
    await db.exec(
      `UPDATE shopfront_clone_alerts SET recheck_dns_fingerprint = 'v1|a=1.2.3.4|aaaa=-|ns=ns1.x',
         recheck_dns_checked_at = now() - interval '7 hours' WHERE id = 1`,
    );
    const r = (await db.query<Record<string, unknown>>(
      `SELECT first_seen_at, recheck_dns_fingerprint, recheck_dns_checked_at, queue_clock_at
       FROM list_clone_alerts_for_recheck(10, 6, 168)`,
    )).rows[0]!;
    expect(r.recheck_dns_fingerprint).toBe("v1|a=1.2.3.4|aaaa=-|ns=ns1.x");
    expect(r.first_seen_at).not.toBeNull();
    expect(String(r.queue_clock_at)).toBe(String(r.recheck_dns_checked_at));
  });

  it("writes the scanned rows' baseline; an inconclusive read keeps the previous baseline", async () => {
    await insert({ id: 1, lastHoursAgo: 12 });
    await insert({ id: 2, lastHoursAgo: 12 });
    await record([], [{ id: 1, fp: "fp-a" }, { id: 2, fp: "fp-b" }]);
    expect((await state(1)).recheck_dns_fingerprint).toBe("fp-a");
    const r = await record([], [{ id: 1, fp: null }, { id: 2, fp: "fp-c" }]);
    expect(r.rows[0]).toMatchObject({ unchanged_stamped: 0, fingerprints_written: 2 });
    expect((await state(1)).recheck_dns_fingerprint).toBe("fp-a");
    expect((await state(2)).recheck_dns_fingerprint).toBe("fp-c");
  });

  it("caps its input", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    await expect(record(ids, [])).rejects.toThrow(/exceeds the 1000 cap/);
    const rows = Array.from({ length: 501 }, (_, i) => ({ id: i + 1, fp: "x" }));
    await expect(record([], rows)).rejects.toThrow(/exceeds the 500 cap/);
  });

  it("clamps the fetch at 1,000, not 500", async () => {
    await db.exec(`INSERT INTO shopfront_clone_alerts (id, candidate_domain, first_seen_at)
      SELECT g, 'd' || g || '.example', now() - interval '1 day' FROM generate_series(1, 1005) g`);
    const r = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM list_clone_alerts_for_recheck(5000, 6, 168)",
    );
    expect(r.rows[0]!.n).toBe(1000);
  });

  it("keeps v326 dormancy and the v317 weekly tier on the new clock", async () => {
    await insert({ id: 1, uuid: null, streak: 8, status: "400" }); // dormant: never due
    await insert({ id: 2, lastHoursAgo: 30, recheckCount: 9 }); // weekly → not due
    await insert({ id: 3, lastHoursAgo: 200, recheckCount: 9 }); // weekly, past → due
    expect(await due()).toEqual([3]);
    await record([3], []);
    expect(await due()).toEqual([]);
    expect(await dormant()).toBe(1);
  });
});
