import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scoreReadiness, toReadinessRow, type ReadinessInputs } from "@/lib/clone-watch/readiness";

// Runs the REAL v335 readiness SQL (#1237) against PGlite: the scorecard
// table's constraints and grants, and clone_watch_readiness_inputs().
//
// Go-red record (2026-09-27, each guard reverted in the migration → its test
// failed → restored):
//   - table: dropped the ready_iff_all_pass CHECK
//        → "ready=true with an insufficient component is rejected" FAILED
//   - table: dropped the first-of-month CHECK
//        → "period_month must be the first of a month" FAILED
//   - inputs: marker `auto-park:%` instead of `auto-park%` (#1260 H1)
//        → "pre-v335 rows: machine note markers … (incl. the backfill form)" FAILED
//   - inputs: dropped the `[matcher-v4-audit]` exclusion
//        → "pre-v335 rows: machine note markers …" FAILED
//   - inputs: judged origin by note marker only, ignoring triage_source (H1)
//        → "triage_source decides when set …" FAILED
//        → "a human verdict through set_clone_alert_triage on an auto-parked alert counts" FAILED
//   - inputs: needs_investigation back in the decided set (H2)
//        → "needs_investigation is a deferral …" FAILED
//   - inputs: tp_actioned not counted as TP (M1)
//        → "counts human DECIDED verdicts … tp_actioned is a TP" FAILED
//   - set_clone_alert_triage: dropped `triage_source = p_source`
//        → "a human verdict through set_clone_alert_triage …" FAILED
//   - set_clone_alert_triage: dropped the p_source validation
//        → "set_clone_alert_triage: one signature, p_source validated …" FAILED
//   - migration: dropped the DROP of the 4-arg signature (two overloads)
//        → "set_clone_alert_triage: one signature …" FAILED
//   - inputs: counted every health-digest row as measured (no jsonb_typeof filter)
//        → "a digest row without lane_problems is NOT a measured day" FAILED
//   - inputs: counted `braked` as a problem kind
//        → "braked is not a lane problem" FAILED
//   - inputs: count(*) instead of count(DISTINCT day) for problem days
//        → "two digest rows on one day count one day" FAILED
//   - inputs: `<= p_end` instead of `< p_end`
//        → "the window is half-open" FAILED
//   - grants: GRANT SELECT ON clone_watch_readiness TO authenticated
//        → "anon/authenticated have no access" FAILED
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.shopfront_clone_alerts (
      id bigint PRIMARY KEY, triage_status text DEFAULT 'pending', triage_at timestamptz,
      triage_by uuid, triage_notes text, weaponised_at timestamptz, urlscan_classification text
    );
    -- The pre-v335 live 4-arg writer (pg_get_functiondef 2026-09-27), so the
    -- migration's DROP + re-create is exercised against what prod has.
    CREATE FUNCTION public.set_clone_alert_triage(p_alert_id bigint, p_status text, p_admin_id uuid, p_notes text DEFAULT NULL::text)
    RETURNS TABLE(id bigint, triage_status text, triage_at timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
    BEGIN
      RETURN QUERY UPDATE public.shopfront_clone_alerts
        SET triage_status = p_status, triage_by = p_admin_id, triage_at = now(),
            triage_notes = COALESCE(p_notes, triage_notes)
      WHERE shopfront_clone_alerts.id = p_alert_id
      RETURNING shopfront_clone_alerts.id, shopfront_clone_alerts.triage_status, shopfront_clone_alerts.triage_at;
    END; $f$;
    CREATE TABLE public.clone_watch_classifications (
      alert_id bigint PRIMARY KEY, is_clone boolean, classified_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.alert_delivery_log (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, alerter text NOT NULL,
      fired_at timestamptz NOT NULL DEFAULT now(), metadata jsonb
    );
  `);
  await db.exec(migration("migration-v335-clone-watch-readiness.sql"));
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () =>
  db.exec(`DELETE FROM shopfront_clone_alerts; DELETE FROM clone_watch_classifications;
            DELETE FROM alert_delivery_log; DELETE FROM clone_watch_readiness;`),
);

let nextId = 1;
async function triaged(
  status: string,
  at: string | null,
  opts: { notes?: string; weaponised?: boolean; cls?: string; source?: string } = {},
) {
  const id = nextId++;
  await db.query(
    `INSERT INTO shopfront_clone_alerts (id, triage_status, triage_at, triage_notes, weaponised_at, urlscan_classification, triage_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, status, at, opts.notes ?? null, opts.weaponised ? (at ?? "2026-09-02") : null, opts.cls ?? null, opts.source ?? null],
  );
  return id;
}
async function digest(at: string, lane_problems?: string[]) {
  const meta = lane_problems === undefined ? { lanes_checked: 20 } : { lane_problems };
  await db.query(`INSERT INTO alert_delivery_log (alerter, fired_at, metadata) VALUES ('health-digest', $1, $2)`, [
    at,
    JSON.stringify(meta),
  ]);
}
async function inputs(start = "2026-09-01T00:00:00Z", end = "2026-10-01T00:00:00Z") {
  const r = await db.query<{ v: Record<string, unknown> }>(
    `SELECT public.clone_watch_readiness_inputs($1::timestamptz, $2::timestamptz) AS v`,
    [start, end],
  );
  return r.rows[0].v;
}

describe("clone_watch_readiness_inputs — triage", () => {
  it("counts human DECIDED verdicts and the phishing subset; tp_actioned is a TP", async () => {
    await triaged("tp_confirmed", "2026-09-05T00:00:00Z", { weaponised: true });
    await triaged("tp_actioned", "2026-09-05T00:00:00Z", { cls: "likely_phishing" });
    await triaged("fp", "2026-09-05T00:00:00Z", { cls: "likely_phishing" });
    await triaged("fp", "2026-09-06T00:00:00Z");
    const v = await inputs();
    expect(v).toMatchObject({ human_decided: 4, human_fp: 2, phishing_tp: 2, phishing_fp: 1 });
  });

  it("needs_investigation is a deferral: in neither numerator nor denominator", async () => {
    await triaged("fp", "2026-09-05T00:00:00Z");
    await triaged("needs_investigation", "2026-09-06T00:00:00Z", { notes: "looks odd" });
    await triaged("needs_investigation", "2026-09-06T00:00:00Z", { source: "human" });
    expect(await inputs()).toMatchObject({ human_decided: 1, human_fp: 1, human_deferred: 2 });
  });

  it("a Netcraft tp_actioned with no triage_at is not a verdict", async () => {
    await triaged("tp_actioned", null, { weaponised: true });
    expect(await inputs()).toMatchObject({ human_decided: 0, phishing_tp: 0 });
  });

  it("pre-v335 rows: machine note markers are not human verdicts (incl. the backfill form)", async () => {
    await triaged("tp_confirmed", "2026-09-05T00:00:00Z", { notes: "auto-triage: confirmed", weaponised: true });
    await triaged("fp", "2026-09-04T00:00:00Z", { notes: "[matcher-v4-audit] Reject: v4 drops it" });
    await triaged("fp", "2026-09-04T00:00:00Z", { notes: "auto-park (one-time backfill 2026-06)" });
    await triaged("fp", "2026-09-04T00:00:00Z", { notes: "operator: parked reseller" });
    expect(await inputs()).toMatchObject({ human_decided: 1, human_fp: 1, phishing_tp: 0, machine_fp: 2 });
  });

  it("triage_source decides when set: human counts despite a machine note, machine never counts", async () => {
    await triaged("fp", "2026-09-04T00:00:00Z", { notes: "[matcher-v4-audit] Reject", source: "human" });
    await triaged("tp_confirmed", "2026-09-04T00:00:00Z", { notes: "no marker at all", source: "machine", weaponised: true });
    expect(await inputs()).toMatchObject({ human_decided: 1, human_fp: 1, phishing_tp: 0 });
  });

  it("a human verdict through set_clone_alert_triage on an auto-parked alert counts (H1)", async () => {
    const id = await triaged("needs_investigation", "2026-09-02T00:00:00Z", {
      notes: "auto-park: pre-classifier is_clone=false",
      source: "machine",
    });
    // The triage route's call shape: four named args, no notes, no source.
    await db.query(
      `SELECT * FROM public.set_clone_alert_triage(p_alert_id => $1, p_status => 'fp', p_admin_id => NULL, p_notes => NULL)`,
      [id],
    );
    const r = await db.query<{ triage_source: string; triage_notes: string }>(
      `SELECT triage_source, triage_notes FROM shopfront_clone_alerts WHERE id = $1`, [id],
    );
    // The note is kept (COALESCE) — which is exactly why origin needs its own column.
    expect(r.rows[0]).toEqual({ triage_source: "human", triage_notes: "auto-park: pre-classifier is_clone=false" });
    expect(await inputs("2026-09-01T00:00:00Z", "2099-01-01T00:00:00Z")).toMatchObject({ human_decided: 1, human_fp: 1 });
  });

  it("set_clone_alert_triage: one signature, p_source validated, machine stampable", async () => {
    const sigs = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'set_clone_alert_triage'`,
    );
    expect(sigs.rows[0].n).toBe(1);
    const id = await triaged("pending", null);
    await expect(
      db.query(`SELECT * FROM public.set_clone_alert_triage($1, 'fp', NULL, NULL, 'robot')`, [id]),
    ).rejects.toThrow(/invalid triage source/);
    await db.query(`SELECT * FROM public.set_clone_alert_triage($1, 'fp', NULL, NULL, 'machine')`, [id]);
    const r = await db.query<{ triage_source: string }>(`SELECT triage_source FROM shopfront_clone_alerts WHERE id = $1`, [id]);
    expect(r.rows[0].triage_source).toBe("machine");
    await expect(
      db.query(`UPDATE shopfront_clone_alerts SET triage_source = 'bot' WHERE id = $1`, [id]),
    ).rejects.toThrow(/triage_source_check/);
  });

  it("the window is half-open", async () => {
    await triaged("fp", "2026-10-01T00:00:00Z");
    await triaged("fp", "2026-09-01T00:00:00Z");
    expect((await inputs()).human_decided).toBe(1);
  });

  it("reports the classifier's reject share as context", async () => {
    await db.exec(`INSERT INTO clone_watch_classifications (alert_id, is_clone, classified_at) VALUES
      (1, false, '2026-09-02'), (2, true, '2026-09-02'), (3, NULL, '2026-09-02'), (4, false, '2026-08-02')`);
    expect(await inputs()).toMatchObject({ classified: 3, classifier_rejected: 1 });
  });
});

describe("clone_watch_readiness_inputs — lane health", () => {
  it("a digest row without lane_problems is NOT a measured day", async () => {
    await digest("2026-09-10T22:00:00Z"); // pre-2026-09-18 shape
    await digest("2026-09-18T22:00:00Z", []);
    const v = await inputs();
    expect(v).toMatchObject({ measured_days: 1, problem_days: 0, window_days: 30 });
  });

  it("counts problem days by kind and lists the lanes", async () => {
    await digest("2026-09-21T22:00:00Z", ["silent_zero:shopfront-clone-feed-platform"]);
    await digest("2026-09-22T22:00:00Z", ["absent:a", "absent:b", "cap_bound:c"]);
    await digest("2026-09-23T22:00:00Z", ["quota_exhausted:d", "brake_unknown:*"]);
    const v = await inputs();
    expect(v.problem_days).toBe(3);
    expect(v.problem_kinds).toEqual({ silent_zero: 1, absent: 1, cap_bound: 1, quota_exhausted: 1, brake_unknown: 1 });
    expect(v.problem_lanes).toEqual(["*", "a", "b", "c", "d", "shopfront-clone-feed-platform"]);
  });

  it("braked is not a lane problem", async () => {
    await digest("2026-09-21T22:00:00Z", ["braked:x"]);
    expect(await inputs()).toMatchObject({ measured_days: 1, problem_days: 0 });
  });

  it("two digest rows on one day count one day", async () => {
    await digest("2026-09-21T01:00:00Z", ["absent:x"]);
    await digest("2026-09-21T22:00:00Z", ["absent:y"]);
    expect(await inputs()).toMatchObject({ measured_days: 1, problem_days: 1, problem_kinds: { absent: 1 } });
  });

  it("other alerters are ignored", async () => {
    await db.query(`INSERT INTO alert_delivery_log (alerter, fired_at, metadata) VALUES ('cost-digest', '2026-09-21', '{"lane_problems":["absent:x"]}')`);
    expect(await inputs()).toMatchObject({ measured_days: 0, problem_days: 0 });
  });
});

const ALL_PASS: ReadinessInputs = {
  periodMonth: "2026-09-01",
  sql: {
    human_decided: 40, human_fp: 4, human_deferred: 0, phishing_tp: 20, phishing_fp: 0, machine_fp: 0,
    classified: 100, classifier_rejected: 14, window_days: 30, measured_days: 30,
    problem_days: 0, problem_kinds: {}, problem_lanes: [],
  },
  notAClone: { sampled: 100, scanned: 60, misses: 1 },
  report: { brandsCompared: 148, maxDiff: 0, brandsDiffering: 0 },
  takedown: { window_days: 30, takedowns_total: 8, timed_n: 0, detect_to_block_n: 0 },
  stock: { stock: 100, unverified: 5, completedAt: "2026-10-01T01:00:00Z" },
};

async function insertRow(row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => (c === "detail" ? JSON.stringify(row[c]) : row[c]));
  await db.query(
    `INSERT INTO clone_watch_readiness (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    vals,
  );
}

describe("clone_watch_readiness — table", () => {
  it("accepts the rows the TypeScript writer produces (ready and not ready)", async () => {
    await insertRow(toReadinessRow(scoreReadiness(ALL_PASS)));
    await insertRow(toReadinessRow(scoreReadiness({ ...ALL_PASS, periodMonth: "2026-08-01", stock: null })));
    const r = await db.query<{ period_month: string; ready: boolean; stock_value: unknown }>(
      `SELECT period_month::text, ready, stock_value FROM clone_watch_readiness ORDER BY 1`,
    );
    expect(r.rows).toEqual([
      { period_month: "2026-08-01", ready: false, stock_value: null },
      { period_month: "2026-09-01", ready: true, stock_value: "0.05" },
    ]);
  });

  it("ready=true with an insufficient component is rejected", async () => {
    const row = { ...toReadinessRow(scoreReadiness({ ...ALL_PASS, stock: null })), ready: true };
    await expect(insertRow(row)).rejects.toThrow(/ready_iff_all_pass/);
    const row2 = { ...toReadinessRow(scoreReadiness(ALL_PASS)), ready: false };
    await expect(insertRow(row2)).rejects.toThrow(/ready_iff_all_pass/);
  });

  it("period_month must be the first of a month", async () => {
    const row = { ...toReadinessRow(scoreReadiness(ALL_PASS)), period_month: "2026-09-15" };
    await expect(insertRow(row)).rejects.toThrow(/check/i);
  });

  it("anon/authenticated have no access; RLS is on; the function is service_role only", async () => {
    const r = await db.query<Record<string, boolean>>(`
      SELECT has_table_privilege('anon', 'public.clone_watch_readiness', 'SELECT') AS anon_sel,
             has_table_privilege('authenticated', 'public.clone_watch_readiness', 'SELECT') AS auth_sel,
             has_table_privilege('service_role', 'public.clone_watch_readiness', 'INSERT') AS svc_ins,
             (SELECT relrowsecurity FROM pg_class WHERE relname = 'clone_watch_readiness') AS rls,
             has_function_privilege('anon', 'public.clone_watch_readiness_inputs(timestamptz, timestamptz)', 'EXECUTE') AS anon_fn,
             has_function_privilege('authenticated', 'public.clone_watch_readiness_inputs(timestamptz, timestamptz)', 'EXECUTE') AS auth_fn,
             has_function_privilege('service_role', 'public.clone_watch_readiness_inputs(timestamptz, timestamptz)', 'EXECUTE') AS svc_fn,
             has_function_privilege('anon', 'public.set_clone_alert_triage(bigint, text, uuid, text, text)', 'EXECUTE') AS anon_tr,
             has_function_privilege('authenticated', 'public.set_clone_alert_triage(bigint, text, uuid, text, text)', 'EXECUTE') AS auth_tr,
             has_function_privilege('service_role', 'public.set_clone_alert_triage(bigint, text, uuid, text, text)', 'EXECUTE') AS svc_tr`);
    expect(r.rows[0]).toEqual({
      anon_sel: false, auth_sel: false, svc_ins: true, rls: true,
      anon_fn: false, auth_fn: false, svc_fn: true,
      anon_tr: false, auth_tr: false, svc_tr: true,
    });
  });

  it("both functions carry a function-level statement_timeout", async () => {
    const r = await db.query<{ proname: string; cfg: string[] }>(
      `SELECT proname, proconfig AS cfg FROM pg_proc
        WHERE proname IN ('clone_watch_readiness_inputs', 'set_clone_alert_triage') ORDER BY 1`,
    );
    expect(r.rows[0].cfg).toContain("statement_timeout=30s");
    expect(r.rows[1].cfg).toContain("statement_timeout=15s");
  });
});
