import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Runs the REAL v330 not-a-clone audit SQL (#1238) against PGlite.
//
// Go-red record (2026-09-26, each guard reverted in the migration → its test
// failed → restored):
//   - list: dropped `s.submit_attempted_at IS NULL`        → "a stamped sample leaves the worklist" FAILED
//   - list: `COALESCE(... '-infinity')` → bare comparison   → "a sample with no evidence at all is offered" FAILED
//   - list: dropped the evidence-attempted_at guard         → "an attempt after the draw removes it even unstamped" FAILED
//   - draw: dropped the cohort_key EXISTS early-return      → "weekly draw happens once per ISO week" FAILED
//   - draw: dropped the NOT EXISTS (already sampled)        → "never samples an alert twice" FAILED
//   - summary: dropped `t.scanned_at >= s.sampled_at`       → "ignores verdicts recorded before the draw" FAILED
//   - summary: ORDER BY scanned_at DESC (latest verdict)    → "a miss is the FIRST post-draw verdict" FAILED
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE shopfront_clone_alerts (
      id bigint PRIMARY KEY, candidate_domain text, candidate_url text,
      source text DEFAULT 'nrd', lifecycle_state text DEFAULT 'detected',
      urlscan_classification text, urlscan_uuid text, urlscan_evidence jsonb,
      urlscan_failure_streak integer DEFAULT 0, first_seen_at timestamptz DEFAULT now(),
      triage_status text DEFAULT 'pending'
    );
    CREATE TABLE clone_watch_classifications (
      alert_id bigint PRIMARY KEY, is_clone boolean, confidence real, model_id text
    );
    CREATE TABLE clone_watch_scan_transitions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      alert_id bigint NOT NULL, new_classification text NOT NULL,
      scanned_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.exec(migration("migration-v330-clone-not-a-clone-audit-sample.sql"));
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () =>
  db.exec(`DELETE FROM clone_watch_not_a_clone_samples; DELETE FROM clone_watch_scan_transitions;
            DELETE FROM clone_watch_classifications; DELETE FROM shopfront_clone_alerts;`),
);

type Alert = {
  id: number;
  isClone?: boolean | null;
  state?: string;
  source?: string;
  uuid?: string | null;
  cls?: string | null;
  evidence?: Record<string, unknown> | null;
  ageDays?: number;
  model?: string;
  streak?: number;
};
async function alert(a: Alert) {
  await db.query(
    `INSERT INTO shopfront_clone_alerts
       (id, candidate_domain, candidate_url, source, lifecycle_state, urlscan_uuid,
        urlscan_classification, urlscan_evidence, first_seen_at, urlscan_failure_streak)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now() - make_interval(days => $9::int), $10)`,
    [
      a.id, `d${a.id}.example`, `https://d${a.id}.example`, a.source ?? "nrd",
      a.state ?? "detected", a.uuid ?? null, a.cls ?? null,
      a.evidence ? JSON.stringify(a.evidence) : null, a.ageDays ?? 1, a.streak ?? 0,
    ],
  );
  if (a.isClone !== null) {
    await db.query(
      `INSERT INTO clone_watch_classifications (alert_id, is_clone, confidence, model_id)
       VALUES ($1, $2, 0.9, $3)`,
      [a.id, a.isClone ?? false, a.model ?? "claude-haiku-4-5-20251001"],
    );
  }
}
const drawBaseline = async (label: string, size: number) =>
  (await db.query<{ n: number }>(
    `SELECT draw_clone_not_a_clone_audit_sample('baseline', $1, $2) AS n`, [label, size],
  )).rows[0]!.n;
const drawWeekly = async (fraction = 0.05, horizon: number | null = 90) =>
  (await db.query<{ n: number }>(
    `SELECT draw_clone_not_a_clone_audit_sample('weekly', NULL, NULL, $1::real, $2::int) AS n`,
    [fraction, horizon],
  )).rows[0]!.n;
const sampled = async () =>
  (await db.query<{ alert_id: number }>(
    "SELECT alert_id FROM clone_watch_not_a_clone_samples ORDER BY alert_id",
  )).rows.map((r) => Number(r.alert_id));
const pending = async () =>
  (await db.query<{ id: number }>("SELECT id FROM list_clone_not_a_clone_audit_pending(100)"))
    .rows.map((r) => Number(r.id));
const stamp = (ids: number[]) =>
  db.query("SELECT mark_clone_not_a_clone_audit_attempted($1::bigint[])", [ids]);
async function verdict(id: number, cls: string, minutesFromNow = 1) {
  await db.query(
    `INSERT INTO clone_watch_scan_transitions (alert_id, new_classification, scanned_at)
     VALUES ($1, $2, now() + make_interval(mins => $3::int))`,
    [id, cls, minutesFromNow],
  );
}
type Summary = {
  cohort: string; classifier: string; sampled: number; attempted: number; scanned: number;
  pending: number; unscannable: number; misses: number; fn_rate: string | null;
  weaponised_later: number; pool_size: number;
};
const summary = async () =>
  (await db.query<Summary>("SELECT * FROM clone_watch_not_a_clone_audit_summary()")).rows;

describe("v330 draw", () => {
  it("samples only never-scanned, detected, nrd, is_clone=false alerts", async () => {
    await alert({ id: 1 }); // eligible
    await alert({ id: 2, evidence: { status: 400, attempted_at: "2026-06-01T00:00:00Z" } }); // old failed attempt, still eligible
    await alert({ id: 3, isClone: true });
    await alert({ id: 4, isClone: null }); // never classified
    await alert({ id: 5, uuid: "scan-5" });
    await alert({ id: 6, cls: "neutral" });
    await alert({ id: 7, state: "monitoring" });
    await alert({ id: 8, source: "manual" });
    expect(await drawBaseline("b1", 100)).toBe(2);
    expect(await sampled()).toEqual([1, 2]);
    const row = (await db.query<{ pool_size: number; model_id: string; cohort_key: string }>(
      "SELECT pool_size, model_id, cohort_key FROM clone_watch_not_a_clone_samples WHERE alert_id = 1",
    )).rows[0]!;
    expect(row).toMatchObject({ pool_size: 2, model_id: "claude-haiku-4-5-20251001", cohort_key: "baseline:b1" });
  });

  it("baseline respects its size, has no horizon, and is idempotent per label", async () => {
    for (let i = 1; i <= 10; i++) await alert({ id: i, ageDays: i * 20 }); // up to 200 days old
    expect(await drawBaseline("b1", 4)).toBe(4);
    expect(await drawBaseline("b1", 4)).toBe(0); // same label: no-op
    expect((await sampled()).length).toBe(4);
    expect(await drawBaseline("b2", 100)).toBe(6); // the rest, including the >90-day rows
  });

  it("never samples an alert twice", async () => {
    for (let i = 1; i <= 3; i++) await alert({ id: i });
    await drawBaseline("b1", 2);
    expect(await drawBaseline("b2", 10)).toBe(1);
    expect(await sampled()).toEqual([1, 2, 3]);
  });

  it("weekly draw takes ceil(fraction × pool), min 1, inside the horizon", async () => {
    for (let i = 1; i <= 30; i++) await alert({ id: i, ageDays: 5 });
    await alert({ id: 99, ageDays: 120 }); // outside the 90-day horizon
    expect(await drawWeekly(0.05, 90)).toBe(2); // ceil(30 × 0.05) = 2
    expect(await sampled()).not.toContain(99);
  });

  it("weekly draw happens once per ISO week", async () => {
    for (let i = 1; i <= 3; i++) await alert({ id: i });
    expect(await drawWeekly()).toBe(1); // min 1
    expect(await drawWeekly()).toBe(0);
    expect((await sampled()).length).toBe(1);
  });

  it("rejects a malformed draw", async () => {
    await expect(db.query("SELECT draw_clone_not_a_clone_audit_sample('baseline')")).rejects.toThrow();
    await expect(db.query("SELECT draw_clone_not_a_clone_audit_sample('weekly')")).rejects.toThrow();
    await expect(db.query("SELECT draw_clone_not_a_clone_audit_sample('other', 'x', 1)")).rejects.toThrow();
  });
});

describe("v330 audit worklist", () => {
  it("a sample with no evidence at all is offered", async () => {
    await alert({ id: 1, evidence: null });
    await drawBaseline("b", 10);
    expect(await pending()).toEqual([1]);
  });

  it("a stamped sample leaves the worklist (starvation rule)", async () => {
    await alert({ id: 1 });
    await alert({ id: 2 });
    await drawBaseline("b", 10);
    await stamp([1]);
    expect(await pending()).toEqual([2]);
  });

  it("an attempt after the draw removes it even unstamped; one before the draw does not", async () => {
    await alert({ id: 1, evidence: { status: 400, attempted_at: "2026-06-01T00:00:00Z" } });
    await alert({ id: 2 });
    await drawBaseline("b", 10);
    expect((await pending()).sort()).toEqual([1, 2]);
    // DNS-precheck stamp written by the submit lane after the draw, stamp write lost:
    await db.query(
      `UPDATE shopfront_clone_alerts SET urlscan_evidence = jsonb_build_object('status', 400, 'attempted_at', now() + interval '1 minute') WHERE id = 2`,
    );
    expect(await pending()).toEqual([1]);
  });

  it("a sample that got a uuid or a verdict by any path leaves the worklist", async () => {
    await alert({ id: 1 });
    await alert({ id: 2 });
    await drawBaseline("b", 10);
    await db.exec(`UPDATE shopfront_clone_alerts SET urlscan_uuid = 'u' WHERE id = 1;
                   UPDATE shopfront_clone_alerts SET urlscan_classification = 'likely_phishing' WHERE id = 2;`);
    expect(await pending()).toEqual([]);
  });

  it("the stamp is idempotent and only counts un-stamped rows", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    const first = (await db.query<{ n: number }>("SELECT mark_clone_not_a_clone_audit_attempted(ARRAY[1,42]::bigint[]) AS n")).rows[0]!.n;
    const again = (await db.query<{ n: number }>("SELECT mark_clone_not_a_clone_audit_attempted(ARRAY[1]::bigint[]) AS n")).rows[0]!.n;
    expect([first, again]).toEqual([1, 0]);
  });
});

describe("v330 summary", () => {
  it("counts scanned / misses / fn_rate / pending / unscannable per classifier", async () => {
    for (let i = 1; i <= 6; i++) await alert({ id: i });
    await alert({ id: 7, model: "jev-1.13.0" });
    await drawBaseline("b", 100);
    await stamp([1, 2, 3, 4, 5, 7]); // 6 never tried → pending
    await verdict(1, "likely_phishing"); // miss
    await verdict(2, "neutral");
    await verdict(3, "parked_for_sale");
    await db.exec("UPDATE shopfront_clone_alerts SET urlscan_evidence = '{\"status\":400}' WHERE id = 4"); // DNS dead: unscannable
    await db.exec("UPDATE shopfront_clone_alerts SET urlscan_uuid = 'u5' WHERE id = 5"); // submitted, awaiting retrieve: pending
    await verdict(7, "neutral");
    const rows = await summary();
    const haiku = rows.find((r) => r.classifier === "haiku")!;
    const jev = rows.find((r) => r.classifier === "jev")!;
    expect(haiku).toMatchObject({
      cohort: "baseline", sampled: 6, attempted: 5, scanned: 3, misses: 1,
      unscannable: 1, pending: 2, weaponised_later: 0, pool_size: 7,
    });
    expect(Number(haiku.fn_rate)).toBeCloseTo(1 / 3, 4);
    expect(jev).toMatchObject({ sampled: 1, scanned: 1, misses: 0 });
    expect(Number(jev.fn_rate)).toBe(0);
  });

  it("a uuid whose retrieve failed out (streak >= 3) is unscannable, not pending", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    await stamp([1]);
    await db.exec("UPDATE shopfront_clone_alerts SET urlscan_uuid = 'u', urlscan_failure_streak = 3 WHERE id = 1");
    expect((await summary())[0]).toMatchObject({ pending: 0, unscannable: 1, fn_rate: null });
  });

  it("ignores verdicts recorded before the draw", async () => {
    await alert({ id: 1 });
    await verdict(1, "likely_phishing", -60); // an hour BEFORE the draw
    await drawBaseline("b", 10);
    expect((await summary())[0]).toMatchObject({ scanned: 0, misses: 0 });
  });

  it("a miss is the FIRST post-draw verdict; a later flip is weaponised_later", async () => {
    await alert({ id: 1 });
    await alert({ id: 2 });
    await drawBaseline("b", 10);
    await verdict(1, "likely_phishing", 1);
    await verdict(1, "neutral", 5);
    await verdict(2, "neutral", 1);
    await verdict(2, "likely_phishing", 5);
    await db.exec("UPDATE shopfront_clone_alerts SET lifecycle_state = 'weaponised' WHERE id = 2");
    expect((await summary())[0]).toMatchObject({ scanned: 2, misses: 1, weaponised_later: 1 });
  });
});
