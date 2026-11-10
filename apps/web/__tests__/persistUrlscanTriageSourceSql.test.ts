import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { suggestTriageTransition } from "@/lib/clone-watch/urlscan-classify";

// Runs the REAL v346 persist_clone_alert_urlscan (#1301) against PGlite, on
// top of the REAL v335 readiness SQL and the v307 body it replaces, through
// urlscan-retrieve's call shape (p_set_triage_status from
// suggestTriageTransition).
//
// The defect: a scan that parked a row (pending → needs_investigation) left
// the previous writer's triage_source, so a human's earlier status made the
// machine's deferral count as human_deferred.
//
// Go-red record (2026-10-13, each change made in the migration → the named
// test failed → restored):
//   - this file against v307 alone (v346 not applied)
//        → "a scan that parks a human's row is a machine deferral" FAILED
//        → "parks NULL-status and pre-v335 rows as machine writes" FAILED
//        → "rejects a verdict from a scan" FAILED
//        → "the CHECK refuses a machine verdict …" FAILED
//        → "keeps the live signature, ACL and a function-level timeout" FAILED
//   - dropped the triage_source assignment from v346's UPDATE
//        → "a scan that parks a human's row is a machine deferral" FAILED
//        → "parks NULL-status and pre-v335 rows as machine writes" FAILED
//   - stamped 'machine' whenever p_set_triage_status was non-NULL (no
//     IS DISTINCT FROM)
//        → "an unchanged status keeps its origin" FAILED
//   - dropped the decided-row guard from the triage_source CASE
//        → "never touches a decided row's status or source" FAILED
//   - CHECK widened to allow 'fp'
//        → "the CHECK refuses a machine verdict" FAILED
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.shopfront_clone_alerts (
      id bigint PRIMARY KEY,
      triage_status text DEFAULT 'pending'
        CHECK (triage_status IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned')),
      triage_at timestamptz, triage_by uuid, triage_notes text,
      weaponised_at timestamptz, lifecycle_state text DEFAULT 'detected',
      urlscan_uuid text, urlscan_evidence jsonb, urlscan_classification text,
      urlscan_scanned_at timestamptz, urlscan_submitted_at timestamptz,
      urlscan_failure_streak integer NOT NULL DEFAULT 0,
      candidate_url text, candidate_domain text, source text DEFAULT 'nrd',
      submitted_to jsonb
    );
    CREATE TABLE public.clone_watch_scan_transitions (
      alert_id bigint, prior_classification text, new_classification text,
      prior_evidence jsonb, new_evidence jsonb, lifecycle_state_at_scan text,
      urlscan_uuid text, urlscan_submitted_at timestamptz, scanned_at timestamptz
    );
    CREATE UNIQUE INDEX ON public.clone_watch_scan_transitions
      (alert_id, COALESCE(urlscan_uuid, ''), new_classification);
    CREATE FUNCTION public.apply_clone_urlscan_verdict(p_alert_id bigint, p_classification text)
    RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
    CREATE FUNCTION public.set_clone_alert_triage(p_alert_id bigint, p_status text, p_admin_id uuid, p_notes text DEFAULT NULL::text)
    RETURNS TABLE(id bigint, triage_status text, triage_at timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
    BEGIN RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::timestamptz; END; $f$;
    CREATE TABLE public.clone_watch_classifications (
      alert_id bigint PRIMARY KEY, is_clone boolean, classified_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.alert_delivery_log (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, alerter text NOT NULL,
      fired_at timestamptz NOT NULL DEFAULT now(), metadata jsonb
    );
  `);
  await db.exec(migration("migration-v335-clone-watch-readiness.sql"));
  await db.exec(migration("migration-v307-clone-scan-atomic-completion.sql"));
  await db.exec(
    migration("migration-v346-persist-urlscan-stamps-triage-source.sql"),
  );
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () =>
  db.exec(
    `DELETE FROM shopfront_clone_alerts; DELETE FROM clone_watch_scan_transitions;`,
  ),
);

let nextId = 1;
async function alert(
  status: string | null,
  source: string | null,
  at: string | null = "2026-09-05T00:00:00Z",
) {
  const id = nextId++;
  await db.query(
    `INSERT INTO shopfront_clone_alerts (id, triage_status, triage_at, triage_source, urlscan_uuid)
     VALUES ($1, $2, $3, $4, 'scan-1')`,
    [id, status, at, source],
  );
  return id;
}
/** urlscan-retrieve's exact call (clone-watch-urlscan-retrieve.ts). */
async function scan(
  id: number,
  classification:
    | "parked_for_sale"
    | "unresolved"
    | "likely_phishing"
    | "neutral",
) {
  const r = await db.query<{ triage_status: string }>(
    `SELECT * FROM public.persist_clone_alert_urlscan(
       p_alert_id => $1, p_urlscan_uuid => 'scan-1', p_urlscan_evidence => '{}'::jsonb,
       p_classification => $2, p_set_triage_status => $3)`,
    [id, classification, suggestTriageTransition(classification)],
  );
  return r.rows[0];
}
async function row(id: number) {
  const r = await db.query<{
    triage_status: string | null;
    triage_source: string | null;
    triage_at: Date | null;
  }>(
    `SELECT triage_status, triage_source, triage_at FROM shopfront_clone_alerts WHERE id = $1`,
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

describe("persist_clone_alert_urlscan — triage_source (v346, #1301)", () => {
  it("a scan that parks a human's row is a machine deferral", async () => {
    // An operator un-parked it to pending; a recheck finds it parked again.
    const id = await alert("pending", "human");
    await scan(id, "parked_for_sale");
    expect(await row(id)).toMatchObject({
      triage_status: "needs_investigation",
      triage_source: "machine",
    });
    expect(await inputs()).toMatchObject({ human_deferred: 0 });
  });

  it("parks NULL-status and pre-v335 rows as machine writes", async () => {
    const untriaged = await alert(null, null, null);
    const pre335 = await alert("pending", null);
    await scan(untriaged, "unresolved");
    await scan(pre335, "parked_for_sale");
    for (const id of [untriaged, pre335]) {
      expect(await row(id)).toMatchObject({
        triage_status: "needs_investigation",
        triage_source: "machine",
      });
    }
    expect(await inputs()).toMatchObject({ human_deferred: 0 });
  });

  it("an unchanged status keeps its origin", async () => {
    const id = await alert("needs_investigation", "human");
    await scan(id, "parked_for_sale");
    expect(await row(id)).toMatchObject({
      triage_status: "needs_investigation",
      triage_source: "human",
    });
    expect(await inputs()).toMatchObject({ human_deferred: 1 });
  });

  it("never touches a decided row's status or source", async () => {
    for (const status of ["tp_confirmed", "tp_actioned", "fp"]) {
      const id = await alert(status, "human");
      await scan(id, "parked_for_sale");
      expect(await row(id)).toMatchObject({
        triage_status: status,
        triage_source: "human",
      });
    }
  });

  it("a scan that suggests nothing leaves triage alone", async () => {
    const id = await alert("pending", "human");
    await scan(id, "likely_phishing");
    expect(await row(id)).toMatchObject({
      triage_status: "pending",
      triage_source: "human",
    });
  });

  it("leaves triage_at alone (the source is what excludes the row)", async () => {
    const id = await alert("pending", "human");
    await scan(id, "unresolved");
    expect((await row(id)).triage_at?.toISOString()).toBe(
      "2026-09-05T00:00:00.000Z",
    );
  });

  it("rejects a verdict from a scan", async () => {
    const id = await alert("pending", null);
    for (const status of ["tp_confirmed", "fp", "pending", "tp_actioned"]) {
      await expect(
        db.query(
          `SELECT * FROM public.persist_clone_alert_urlscan($1, 'scan-1', '{}'::jsonb, 'neutral', $2)`,
          [id, status],
        ),
      ).rejects.toThrow(/only needs_investigation/);
    }
  });

  it("the CHECK refuses a machine verdict and admits a machine park or action", async () => {
    const id = await alert("pending", null);
    for (const status of ["fp", "tp_confirmed", "pending"]) {
      await expect(
        db.query(
          `UPDATE shopfront_clone_alerts SET triage_status = $2, triage_source = 'machine' WHERE id = $1`,
          [id, status],
        ),
      ).rejects.toThrow(/machine_triage_status_check/);
    }
    for (const status of ["needs_investigation", "tp_actioned"]) {
      await db.query(
        `UPDATE shopfront_clone_alerts SET triage_status = $2, triage_source = 'machine' WHERE id = $1`,
        [id, status],
      );
    }
    // A human verdict is unaffected.
    await db.query(
      `UPDATE shopfront_clone_alerts SET triage_status = 'fp', triage_source = 'human' WHERE id = $1`,
      [id],
    );
  });

  it("backfills only NULL-source needs_investigation rows with no triage_at", async () => {
    const persisted = await alert("needs_investigation", null, null);
    const human = await alert("needs_investigation", null);
    const backfill = migration(
      "migration-v346-persist-urlscan-stamps-triage-source.sql",
    ).match(
      /UPDATE public\.shopfront_clone_alerts\s+SET triage_source = 'machine'[\s\S]*?;/,
    )![0];
    await db.exec(backfill);
    expect((await row(persisted)).triage_source).toBe("machine");
    expect((await row(human)).triage_source).toBeNull();
  });

  it("keeps the live signature, ACL and a function-level timeout", async () => {
    const r = await db.query<{
      n: number;
      cfg: string[];
      anon: boolean;
      authd: boolean;
      pub: boolean;
      svc: boolean;
    }>(
      `SELECT count(*) OVER ()::int AS n, p.proconfig AS cfg,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authd,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
         FROM pg_proc p WHERE p.proname = 'persist_clone_alert_urlscan'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      n: 1,
      anon: false,
      authd: false,
      pub: false,
      svc: true,
    });
    expect(r.rows[0].cfg).toEqual(
      expect.arrayContaining(["statement_timeout=30s", 'search_path=""']),
    );
  });
});
