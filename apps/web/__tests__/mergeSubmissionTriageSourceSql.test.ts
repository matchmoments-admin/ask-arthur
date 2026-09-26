import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Runs the REAL v338 merge_clone_alert_submission (#1263) against PGlite, on
// top of the REAL v335 readiness SQL, through the auto lane's exact call shape
// (recordAutoSubmission: key 'netcraft', p_set_triage_status 'tp_actioned').
//
// The defect: the Netcraft auto lane rewrote a human `needs_investigation` to
// `tp_actioned` without touching triage_source, and clone_watch_readiness_inputs
// then counted it as a human DECIDED true positive.
//
// Go-red record (2026-09-27, each guard reverted in the migration → its test
// failed → restored):
//   - dropped the triage_source assignment (the pre-v338 live body)
//        → "a human needs_investigation actioned by the lane is NOT a human TP" FAILED
//        → "any status change by this function is a machine origin" FAILED
//   - stamped 'machine' on every change (no tp_confirmed → tp_actioned exception)
//        → "tp_confirmed → tp_actioned keeps the human origin and counts" FAILED
//        → "tp_confirmed with a pre-v335 NULL source stays NULL …" FAILED
//   - stamped 'machine' whenever p_set_triage_status was non-NULL (no
//     IS DISTINCT FROM check)
//        → "an unchanged status keeps its origin (resubmission)" FAILED
//   - `ELSE NULL` instead of `ELSE sca.triage_source`
//        → "an unchanged status keeps its origin (resubmission)" FAILED
//        → "a NULL status argument never touches triage_source …" FAILED
//   - `sca.triage_status = 'tp_confirmed'` instead of IS NOT DISTINCT FROM
//     (a NULL prior status makes NOT (NULL AND …) NULL → ELSE, unstamped —
//     the first draft of v338 shipped exactly this and this test caught it)
//        → "any status change by this function is a machine origin" FAILED
//   - dropped the function-level SET statement_timeout
//        → "keeps the live signature, ACL and a function-level timeout" FAILED
//   - dropped the REVOKE: CREATE OR REPLACE keeps the setup's ACL, so this
//     file cannot see it — migrationLint.test.ts is the guard
//        → "every … SECURITY DEFINER function revokes PUBLIC" FAILED
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.shopfront_clone_alerts (
      id bigint PRIMARY KEY, triage_status text DEFAULT 'pending', triage_at timestamptz,
      triage_by uuid, triage_notes text, weaponised_at timestamptz, urlscan_classification text,
      submitted_to jsonb
    );
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
    -- The pre-v338 LIVE body (pg_get_functiondef 2026-09-27), so the
    -- migration's CREATE OR REPLACE is exercised against what prod has.
    CREATE FUNCTION public.merge_clone_alert_submission(p_alert_id bigint, p_key text, p_value jsonb, p_set_triage_status text DEFAULT NULL::text)
    RETURNS TABLE(id bigint, submitted_to jsonb, triage_status text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
    BEGIN
      RETURN QUERY
      UPDATE public.shopfront_clone_alerts AS sca
      SET submitted_to = jsonb_set(COALESCE(sca.submitted_to, '{}'::jsonb), ARRAY[p_key], p_value, true),
          triage_status = COALESCE(p_set_triage_status, sca.triage_status)
      WHERE sca.id = p_alert_id
      RETURNING sca.id, sca.submitted_to, sca.triage_status;
    END; $f$;
    REVOKE ALL ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text) TO service_role;
    CREATE TABLE public.clone_watch_classifications (
      alert_id bigint PRIMARY KEY, is_clone boolean, classified_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.alert_delivery_log (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, alerter text NOT NULL,
      fired_at timestamptz NOT NULL DEFAULT now(), metadata jsonb
    );
  `);
  await db.exec(migration("migration-v335-clone-watch-readiness.sql"));
  await db.exec(migration("migration-v338-merge-submission-stamps-triage-source.sql"));
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () => db.exec(`DELETE FROM shopfront_clone_alerts;`));

let nextId = 1;
async function alert(status: string | null, source: string | null, at: string | null = "2026-09-05T00:00:00Z") {
  const id = nextId++;
  await db.query(
    `INSERT INTO shopfront_clone_alerts (id, triage_status, triage_at, triage_source, weaponised_at)
     VALUES ($1, $2, $3, $4, '2026-09-04T00:00:00Z')`,
    [id, status, at, source],
  );
  return id;
}
/** recordAutoSubmission's exact call (netcraft-report.ts). */
async function autoLane(id: number, status: string | null = "tp_actioned") {
  const r = await db.query<{ triage_status: string }>(
    `SELECT * FROM public.merge_clone_alert_submission(
       p_alert_id => $1, p_key => 'netcraft',
       p_value => '{"uuid":"u-1","state":"processing","via":"auto_bulk"}'::jsonb,
       p_set_triage_status => $2)`,
    [id, status],
  );
  return r.rows[0];
}
async function row(id: number) {
  const r = await db.query<{ triage_status: string; triage_source: string | null; triage_at: Date | null; via: string }>(
    `SELECT triage_status, triage_source, triage_at, submitted_to->'netcraft'->>'via' AS via
       FROM shopfront_clone_alerts WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}
async function inputs() {
  const r = await db.query<{ v: Record<string, unknown> }>(
    `SELECT public.clone_watch_readiness_inputs('2026-09-01'::timestamptz, '2026-10-01'::timestamptz) AS v`,
  );
  return r.rows[0].v;
}

describe("merge_clone_alert_submission — triage_source (v338, #1263)", () => {
  it("a human needs_investigation actioned by the lane is NOT a human TP", async () => {
    const id = await alert("needs_investigation", "human");
    const out = await autoLane(id);
    expect(out.triage_status).toBe("tp_actioned");
    const r = await row(id);
    expect(r).toMatchObject({ triage_status: "tp_actioned", triage_source: "machine", via: "auto_bulk" });
    expect(r.triage_at).not.toBeNull(); // triage_at untouched — the source is what excludes it
    expect(await inputs()).toMatchObject({ human_decided: 0, phishing_tp: 0 });
  });

  it("tp_confirmed → tp_actioned keeps the human origin and counts", async () => {
    const id = await alert("tp_confirmed", "human");
    await autoLane(id);
    expect(await row(id)).toMatchObject({ triage_status: "tp_actioned", triage_source: "human" });
    expect(await inputs()).toMatchObject({ human_decided: 1, phishing_tp: 1 });
  });

  it("tp_confirmed with a pre-v335 NULL source stays NULL (judged by the note rule)", async () => {
    const id = await alert("tp_confirmed", null);
    await autoLane(id);
    expect((await row(id)).triage_source).toBeNull();
  });

  it("any status change by this function is a machine origin", async () => {
    const pending = await alert("pending", null, null);
    const untriaged = await alert(null, null, null);
    const pre335 = await alert("needs_investigation", null);
    for (const id of [pending, untriaged, pre335]) await autoLane(id);
    for (const id of [pending, untriaged, pre335]) {
      expect(await row(id)).toMatchObject({ triage_status: "tp_actioned", triage_source: "machine" });
    }
    expect(await inputs()).toMatchObject({ human_decided: 0 });
  });

  it("an unchanged status keeps its origin (resubmission)", async () => {
    const id = await alert("tp_actioned", "human");
    await autoLane(id);
    expect(await row(id)).toMatchObject({ triage_status: "tp_actioned", triage_source: "human" });
    expect(await inputs()).toMatchObject({ human_decided: 1 });
  });

  it("a NULL status argument never touches triage_source (notify / urlscan / admin callers)", async () => {
    const human = await alert("needs_investigation", "human");
    const machine = await alert("fp", "machine");
    await autoLane(human, null);
    await autoLane(machine, null);
    expect(await row(human)).toMatchObject({ triage_status: "needs_investigation", triage_source: "human", via: "auto_bulk" });
    expect(await row(machine)).toMatchObject({ triage_status: "fp", triage_source: "machine" });
  });

  it("still validates the key and the status", async () => {
    const id = await alert("pending", null);
    await expect(
      db.query(`SELECT * FROM public.merge_clone_alert_submission($1, '', '{}'::jsonb, NULL)`, [id]),
    ).rejects.toThrow(/invalid merge key/);
    await expect(
      db.query(`SELECT * FROM public.merge_clone_alert_submission($1, 'netcraft', '{}'::jsonb, 'done')`, [id]),
    ).rejects.toThrow(/invalid triage status/);
  });

  it("keeps the live signature, ACL and a function-level timeout", async () => {
    const r = await db.query<{ n: number; cfg: string[]; anon: boolean; authd: boolean; pub: boolean; svc: boolean }>(
      `SELECT count(*) OVER ()::int AS n, p.proconfig AS cfg,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authd,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
         FROM pg_proc p WHERE p.proname = 'merge_clone_alert_submission'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ n: 1, anon: false, authd: false, pub: false, svc: true });
    expect(r.rows[0].cfg).toEqual(expect.arrayContaining(["statement_timeout=15s"]));
  });
});
