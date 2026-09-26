import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Runs the REAL v330 not-a-clone audit SQL (#1238) against PGlite, on top of the
// REAL v307 persist_clone_alert_urlscan and the v328 recheck worklist it
// replaces — so the "a miss is never weaponised" guarantee is proven through
// the same persist path the retrieve lane calls.
//
// Go-red record (2026-09-26, each guard reverted in the migration → its test
// failed → restored):
//   - apply: dropped the audit branch (miss → weaponised again)
//        → "a sampled miss never reaches weaponised or weaponised_at" FAILED
//   - apply: keyed the branch on sample membership only (no is_clone check)
//        → "a sample later re-judged is_clone=true weaponises normally" FAILED
//   - draw: dropped the triage_status <> 'fp' filter      → "samples only never-scanned … non-fp" FAILED
//   - draw: dropped ON CONFLICT (alert_id) DO NOTHING     → "a draw under another key skips … instead of raising" FAILED
//   - draw: dropped the cohort_key EXISTS early-return     → "weekly draw happens once per ISO week" FAILED
//   - states: broke the 168 h cadence comparison           → "a failed attempt waits 168 h, then is re-offered" FAILED
//   - states: `attempts >= p_max_attempts` check removed   → "unscannable only when attempts are exhausted" FAILED
//   - states: dropped the evidence attempted_at clock      → "a lost stamp still waits out the cadence" FAILED
//   - list: ORDER BY sampled_at only                       → "never-tried rows go before retries" FAILED
//   - summary: `t.scanned_at >= s.sampled_at` removed      → "ignores verdicts recorded before the draw" FAILED
//   - summary: latest verdict instead of first             → "a miss is the FIRST post-draw verdict" FAILED
//   - recheck: dropped the audit weekly-cadence branch     → "sampled not-a-clones are rechecked weekly" FAILED
//   - recheck: dropped the COALESCE(…, urlscan_scanned_at) clock
//        → "a freshly scanned sample does not jump the NULL-first queue" FAILED
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.shopfront_clone_alerts (
      id bigint PRIMARY KEY, candidate_domain text, candidate_url text,
      source text DEFAULT 'nrd', lifecycle_state text DEFAULT 'detected',
      urlscan_classification text, urlscan_uuid text, urlscan_evidence jsonb,
      urlscan_failure_streak integer DEFAULT 0, urlscan_scanned_at timestamptz,
      urlscan_submitted_at timestamptz, recheck_count integer DEFAULT 0,
      last_rechecked_at timestamptz, first_seen_at timestamptz DEFAULT now(),
      triage_status text DEFAULT 'pending', weaponised_at timestamptz,
      evidence jsonb DEFAULT '{}'::jsonb, updated_at timestamptz,
      signals jsonb, attribution jsonb, inferred_target_domain text
    );
    CREATE TABLE public.clone_watch_classifications (
      alert_id bigint PRIMARY KEY, is_clone boolean, confidence real, model_id text,
      classified_at timestamptz DEFAULT now(), attack_intent text, clone_tactic text
    );
    CREATE TABLE public.clone_watch_scan_transitions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      alert_id bigint NOT NULL, prior_classification text, new_classification text NOT NULL,
      prior_evidence jsonb, new_evidence jsonb, lifecycle_state_at_scan text,
      urlscan_uuid text, urlscan_submitted_at timestamptz,
      scanned_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz DEFAULT now()
    );
    CREATE UNIQUE INDEX uq_cw_scan_transitions_dedup ON public.clone_watch_scan_transitions
      (alert_id, COALESCE(urlscan_uuid, ''), new_classification);
    CREATE TABLE public.known_brands (brand_domain text, brand_category text);
  `);
  await db.exec(migration("migration-v307-clone-scan-atomic-completion.sql"));
  await db.exec(migration("migration-v328-recheck-due-total.sql"));
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
  triage?: string;
};
async function alert(a: Alert) {
  await db.query(
    `INSERT INTO shopfront_clone_alerts
       (id, candidate_domain, candidate_url, source, lifecycle_state, urlscan_uuid,
        urlscan_classification, urlscan_evidence, first_seen_at, triage_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now() - make_interval(days => $9::int), $10)`,
    [
      a.id, `d${a.id}.example`, `https://d${a.id}.example`, a.source ?? "nrd",
      a.state ?? "detected", a.uuid ?? null, a.cls ?? null,
      a.evidence ? JSON.stringify(a.evidence) : null, a.ageDays ?? 1, a.triage ?? "pending",
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
const ageAttempt = (id: number, hours: number) =>
  db.query(
    `UPDATE clone_watch_not_a_clone_samples SET last_attempt_at = now() - make_interval(hours => $2::int) WHERE alert_id = $1`,
    [id, hours],
  );
async function verdict(id: number, cls: string, minutesFromNow = 1) {
  await db.query(
    `INSERT INTO clone_watch_scan_transitions (alert_id, new_classification, scanned_at, urlscan_uuid)
     VALUES ($1, $2, now() + make_interval(mins => $3::int), $4)`,
    [id, cls, minutesFromNow, `u${id}-${cls}-${minutesFromNow}`],
  );
}
/** The retrieve lane's real write: persist_clone_alert_urlscan (v307). */
const persist = (id: number, cls: string) =>
  db.query(
    `SELECT * FROM persist_clone_alert_urlscan($1, $2, '{"stage":"retrieved"}'::jsonb, $3, NULL)`,
    [id, `scan-${id}-${cls}`, cls],
  );
const row = async (id: number) =>
  (await db.query<{ lifecycle_state: string; weaponised_at: string | null; urlscan_classification: string }>(
    "SELECT lifecycle_state, weaponised_at, urlscan_classification FROM shopfront_clone_alerts WHERE id = $1",
    [id],
  )).rows[0]!;
const sampleRow = async (id: number) =>
  (await db.query<{ miss_at: string | null; attempts: number }>(
    "SELECT miss_at, attempts FROM clone_watch_not_a_clone_samples WHERE alert_id = $1", [id],
  )).rows[0]!;
type Summary = {
  cohort: string; classifier: string; age_band: string; sampled: number; attempted: number;
  scanned: number; pending: number; unscannable: number; misses: number; fn_rate: string | null;
  verdict_neutral: number; verdict_parked_for_sale: number; verdict_likely_phishing: number;
  phishing_later: number; weaponised_later: number; pool_size: number;
};
const summary = async () =>
  (await db.query<Summary>("SELECT * FROM clone_watch_not_a_clone_audit_summary()")).rows;

describe("v330: a miss is measurement, never an action", () => {
  it("a sampled miss never reaches weaponised or weaponised_at (via persist)", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    await persist(1, "likely_phishing");
    expect(await row(1)).toMatchObject({
      lifecycle_state: "monitoring", weaponised_at: null, urlscan_classification: "likely_phishing",
    });
    expect((await sampleRow(1)).miss_at).not.toBeNull();
    // A later recheck verdict from monitoring is blocked the same way.
    await db.query("SELECT persist_clone_alert_urlscan(1, 'scan-2', '{}'::jsonb, 'likely_phishing', NULL)");
    expect(await row(1)).toMatchObject({ lifecycle_state: "monitoring", weaponised_at: null });
  });

  it("a non-sampled alert still weaponises (the edge is unchanged for everything else)", async () => {
    await alert({ id: 1, isClone: true });
    await alert({ id: 2, isClone: false }); // not-a-clone but NOT sampled
    await persist(1, "likely_phishing");
    await persist(2, "likely_phishing");
    expect((await row(1)).lifecycle_state).toBe("weaponised");
    expect((await row(2)).lifecycle_state).toBe("weaponised");
  });

  it("a sample later re-judged is_clone=true weaponises normally", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    await db.exec("UPDATE clone_watch_classifications SET is_clone = true WHERE alert_id = 1");
    await persist(1, "likely_phishing");
    expect((await row(1)).lifecycle_state).toBe("weaponised");
    expect((await sampleRow(1)).miss_at).toBeNull();
  });

  it("a benign sample verdict goes detected → monitoring, no miss", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    await persist(1, "neutral");
    expect((await row(1)).lifecycle_state).toBe("monitoring");
    expect((await sampleRow(1)).miss_at).toBeNull();
  });

  it("each miss is claimed for the operator warn exactly once", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    await persist(1, "likely_phishing");
    const first = (await db.query<{ alert_id: number }>("SELECT * FROM claim_clone_not_a_clone_audit_misses(50)")).rows;
    const again = (await db.query("SELECT * FROM claim_clone_not_a_clone_audit_misses(50)")).rows;
    expect(first.map((r) => Number(r.alert_id))).toEqual([1]);
    expect(again).toEqual([]);
  });
});

describe("v330 draw", () => {
  it("samples only never-scanned, detected, nrd, is_clone=false, non-fp alerts", async () => {
    await alert({ id: 1 }); // eligible
    await alert({ id: 2, evidence: { status: 400, attempted_at: "2026-06-01T00:00:00Z" } }); // old failed attempt, eligible
    await alert({ id: 3, isClone: true });
    await alert({ id: 4, isClone: null }); // never classified
    await alert({ id: 5, uuid: "scan-5" });
    await alert({ id: 6, cls: "neutral" });
    await alert({ id: 7, state: "monitoring" });
    await alert({ id: 8, source: "manual" });
    await alert({ id: 9, triage: "fp" });
    expect(await drawBaseline("b1", 100)).toBe(2);
    expect(await sampled()).toEqual([1, 2]);
    const r = (await db.query<{ pool_size: number; model_id: string; cohort_key: string; first_seen_at: string; classified_at: string }>(
      "SELECT pool_size, model_id, cohort_key, first_seen_at, classified_at FROM clone_watch_not_a_clone_samples WHERE alert_id = 1",
    )).rows[0]!;
    expect(r).toMatchObject({ pool_size: 2, model_id: "claude-haiku-4-5-20251001", cohort_key: "baseline:b1" });
    expect(r.first_seen_at).not.toBeNull();
    expect(r.classified_at).not.toBeNull();
  });

  it("baseline respects its size, has no horizon, and is idempotent per label", async () => {
    for (let i = 1; i <= 10; i++) await alert({ id: i, ageDays: i * 20 });
    expect(await drawBaseline("b1", 4)).toBe(4);
    expect(await drawBaseline("b1", 4)).toBe(0);
    expect((await sampled()).length).toBe(4);
    expect(await drawBaseline("b2", 100)).toBe(6);
  });

  it("never samples an alert twice", async () => {
    for (let i = 1; i <= 3; i++) await alert({ id: i });
    await drawBaseline("b1", 2);
    expect(await drawBaseline("b2", 10)).toBe(1);
    expect(await sampled()).toEqual([1, 2, 3]);
  });

  it("a draw under another key skips an already-sampled alert instead of raising", async () => {
    await alert({ id: 1 });
    // Simulate the concurrent-draw race: the row is inserted by another key
    // after this draw's snapshot. A trigger inserts it just before our INSERT.
    await db.exec(`
      CREATE OR REPLACE FUNCTION public._race() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.cohort_key = 'baseline:late' AND NOT EXISTS (
          SELECT 1 FROM public.clone_watch_not_a_clone_samples WHERE alert_id = NEW.alert_id) THEN
          INSERT INTO public.clone_watch_not_a_clone_samples (alert_id, cohort, cohort_key, pool_size)
          VALUES (NEW.alert_id, 'weekly', 'weekly:race', 1);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER _race BEFORE INSERT ON public.clone_watch_not_a_clone_samples
        FOR EACH ROW EXECUTE FUNCTION public._race();
    `);
    try {
      expect(await drawBaseline("late", 10)).toBe(0);
    } finally {
      await db.exec("DROP TRIGGER _race ON public.clone_watch_not_a_clone_samples; DROP FUNCTION public._race();");
    }
  });

  it("weekly draw takes ceil(fraction × pool), min 1, inside the horizon", async () => {
    for (let i = 1; i <= 30; i++) await alert({ id: i, ageDays: 5 });
    await alert({ id: 99, ageDays: 120 });
    expect(await drawWeekly(0.05, 90)).toBe(2);
    expect(await sampled()).not.toContain(99);
  });

  it("weekly draw happens once per ISO week", async () => {
    for (let i = 1; i <= 3; i++) await alert({ id: i });
    expect(await drawWeekly()).toBe(1);
    expect(await drawWeekly()).toBe(0);
    expect((await sampled()).length).toBe(1);
  });

  it("rejects a malformed draw", async () => {
    await expect(db.query("SELECT draw_clone_not_a_clone_audit_sample('baseline')")).rejects.toThrow();
    await expect(db.query("SELECT draw_clone_not_a_clone_audit_sample('weekly')")).rejects.toThrow();
    await expect(db.query("SELECT draw_clone_not_a_clone_audit_sample('other', 'x', 1)")).rejects.toThrow();
  });
});

describe("v330 attempts + worklist", () => {
  it("a never-tried sample is offered", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    expect(await pending()).toEqual([1]);
  });

  it("a failed attempt waits 168 h, then is re-offered", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    await stamp([1]);
    expect(await pending()).toEqual([]);
    await ageAttempt(1, 169);
    expect(await pending()).toEqual([1]);
  });

  it("unscannable only when attempts are exhausted", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    for (let i = 0; i < 2; i++) {
      await stamp([1]);
      await ageAttempt(1, 200);
    }
    expect(await pending()).toEqual([1]);
    expect((await summary())[0]).toMatchObject({ unscannable: 0, pending: 1, attempted: 1 });
    await stamp([1]);
    await ageAttempt(1, 200);
    expect(await pending()).toEqual([]);
    expect((await summary())[0]).toMatchObject({ unscannable: 1, pending: 0 });
  });

  it("a lost stamp still waits out the cadence (evidence attempted_at clock)", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    await db.exec(
      `UPDATE shopfront_clone_alerts SET urlscan_evidence = jsonb_build_object('status', 400, 'attempted_at', now() + interval '1 minute') WHERE id = 1`,
    );
    expect(await pending()).toEqual([]);
  });

  it("an attempt recorded BEFORE the draw does not delay the sample", async () => {
    await alert({ id: 1, evidence: { status: 400, attempted_at: "2026-06-01T00:00:00Z" } });
    await drawBaseline("b", 10);
    expect(await pending()).toEqual([1]);
  });

  it("never-tried rows go before retries", async () => {
    await alert({ id: 1 });
    await alert({ id: 2 });
    await drawBaseline("b", 10);
    await stamp([1]);
    await ageAttempt(1, 500); // retry due, but tried
    await db.exec("UPDATE clone_watch_not_a_clone_samples SET sampled_at = now() - interval '30 days' WHERE alert_id = 1");
    expect(await pending()).toEqual([2, 1]);
  });

  it("a sample in flight (uuid, retrieve not failed out) is not offered", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 10);
    await stamp([1]);
    await ageAttempt(1, 500);
    await db.exec("UPDATE shopfront_clone_alerts SET urlscan_uuid = 'u' WHERE id = 1");
    expect(await pending()).toEqual([]);
    await db.exec("UPDATE shopfront_clone_alerts SET urlscan_failure_streak = 3 WHERE id = 1");
    expect(await pending()).toEqual([1]); // retrieve failed out → re-offer
  });
});

describe("v330 summary", () => {
  it("counts scanned / misses / fn_rate / per-verdict / pending / unscannable per classifier", async () => {
    for (let i = 1; i <= 6; i++) await alert({ id: i, ageDays: 10 });
    await alert({ id: 7, model: "jev-1.13.0", ageDays: 10 });
    await drawBaseline("b", 100);
    await stamp([1, 2, 3, 4, 5, 7]);
    await verdict(1, "likely_phishing");
    await verdict(2, "neutral");
    await verdict(3, "parked_for_sale");
    await db.exec("UPDATE clone_watch_not_a_clone_samples SET attempts = 3 WHERE alert_id = 4"); // exhausted
    await db.exec("UPDATE shopfront_clone_alerts SET urlscan_uuid = 'u5' WHERE id = 5"); // in flight
    await verdict(7, "neutral");
    const rows = await summary();
    const haiku = rows.find((r) => r.classifier === "haiku")!;
    const jev = rows.find((r) => r.classifier === "jev")!;
    expect(haiku).toMatchObject({
      cohort: "baseline", age_band: "0-30d", sampled: 6, attempted: 5, scanned: 3, misses: 1,
      verdict_likely_phishing: 1, verdict_neutral: 1, verdict_parked_for_sale: 1,
      unscannable: 1, pending: 2, weaponised_later: 0, pool_size: 7,
    });
    expect(Number(haiku.fn_rate)).toBeCloseTo(1 / 3, 4);
    expect(jev).toMatchObject({ sampled: 1, scanned: 1, misses: 0 });
  });

  it("splits by age band at draw time", async () => {
    await alert({ id: 1, ageDays: 10 });
    await alert({ id: 2, ageDays: 60 });
    await alert({ id: 3, ageDays: 120 });
    await drawBaseline("b", 10);
    expect((await summary()).map((r) => r.age_band).sort()).toEqual(["0-30d", "31-90d", "90d+"]);
  });

  it("ignores verdicts recorded before the draw", async () => {
    await alert({ id: 1 });
    await verdict(1, "likely_phishing", -60);
    await drawBaseline("b", 10);
    expect((await summary())[0]).toMatchObject({ scanned: 0, misses: 0 });
  });

  it("a miss is the FIRST post-draw verdict; a later flip is phishing_later", async () => {
    await alert({ id: 1 });
    await alert({ id: 2 });
    await drawBaseline("b", 10);
    await verdict(1, "likely_phishing", 1);
    await verdict(1, "neutral", 5);
    await verdict(2, "neutral", 1);
    await verdict(2, "likely_phishing", 5);
    expect((await summary())[0]).toMatchObject({ scanned: 2, misses: 1, phishing_later: 1, weaponised_later: 0 });
  });

  it("weaponised_later reads weaponised_at, not the lifecycle label", async () => {
    await alert({ id: 1, state: "detected" });
    await drawBaseline("b", 10);
    await verdict(1, "neutral");
    await db.exec("UPDATE shopfront_clone_alerts SET lifecycle_state = 'taken_down' WHERE id = 1"); // never weaponised
    expect((await summary())[0]).toMatchObject({ weaponised_later: 0 });
    await db.exec("UPDATE shopfront_clone_alerts SET weaponised_at = now() WHERE id = 1");
    expect((await summary())[0]).toMatchObject({ weaponised_later: 1 });
  });
});

describe("v330 recheck worklist", () => {
  const due = async () =>
    (await db.query<{ id: number; due_total: number }>(
      "SELECT id, due_total FROM list_clone_alerts_for_recheck(500, 6, 168)",
    )).rows;
  const setMonitoring = (id: number, scannedHoursAgo: number, recheckedHoursAgo: number | null) =>
    db.query(
      `UPDATE shopfront_clone_alerts SET lifecycle_state = 'monitoring', urlscan_uuid = 'u',
         urlscan_scanned_at = now() - make_interval(hours => $2::int),
         last_rechecked_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() - make_interval(hours => $3::int) END
       WHERE id = $1`,
      [id, scannedHoursAgo, recheckedHoursAgo],
    );

  it("sampled not-a-clones are rechecked weekly; ordinary rows keep 6 h", async () => {
    await alert({ id: 1 }); // will be sampled
    await alert({ id: 2, isClone: true }); // ordinary
    await drawBaseline("b", 1);
    await db.exec("DELETE FROM clone_watch_not_a_clone_samples WHERE alert_id <> 1");
    await setMonitoring(1, 300, 12);
    await setMonitoring(2, 300, 12);
    expect((await due()).map((r) => Number(r.id))).toEqual([2]);
    await setMonitoring(1, 300, 200);
    expect((await due()).map((r) => Number(r.id)).sort()).toEqual([1, 2]);
  });

  it("a freshly scanned sample does not jump the NULL-first queue", async () => {
    await alert({ id: 1 });
    await drawBaseline("b", 1);
    await setMonitoring(1, 2, null); // audit scan 2 h ago, never rechecked
    expect(await due()).toEqual([]);
    await setMonitoring(1, 200, null);
    const rows = await due();
    expect(rows.map((r) => Number(r.id))).toEqual([1]);
    expect(Number(rows[0]!.due_total)).toBe(1);
  });
});
