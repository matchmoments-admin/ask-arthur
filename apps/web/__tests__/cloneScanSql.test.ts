import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE shopfront_clone_alerts (
      id bigint PRIMARY KEY, candidate_url text, candidate_domain text,
      source text DEFAULT 'nrd', urlscan_uuid text, urlscan_evidence jsonb,
      urlscan_classification text, urlscan_scanned_at timestamptz,
      urlscan_submitted_at timestamptz, urlscan_failure_streak integer DEFAULT 0,
      lifecycle_state text DEFAULT 'detected', triage_status text DEFAULT 'pending',
      weaponised_at timestamptz, evidence jsonb DEFAULT '{}', updated_at timestamptz
    );
    CREATE TABLE clone_watch_scan_transitions (
      alert_id bigint, prior_classification text, new_classification text,
      prior_evidence jsonb, new_evidence jsonb, lifecycle_state_at_scan text,
      urlscan_uuid text, urlscan_submitted_at timestamptz, scanned_at timestamptz
    );
    CREATE UNIQUE INDEX transition_dedup ON clone_watch_scan_transitions
      (alert_id, COALESCE(urlscan_uuid, ''), new_classification);
  `);
  await db.exec(migration("migration-v200-clone-urlscan-verdict.sql"));
  await db.exec(migration("migration-v307-clone-scan-atomic-completion.sql"));

}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec(`DROP TRIGGER IF EXISTS reject_lifecycle ON shopfront_clone_alerts;
    DELETE FROM clone_watch_scan_transitions; DELETE FROM shopfront_clone_alerts;
    INSERT INTO shopfront_clone_alerts(id, candidate_domain, candidate_url,
      urlscan_uuid, urlscan_classification, urlscan_scanned_at, urlscan_submitted_at, lifecycle_state)
    VALUES (1,'clone.example','https://clone.example','scan-1','neutral',now()-interval '2 days',now()-interval '1 hour','monitoring');`);
});
const persist = (classification: string | null) => db.query(
  "SELECT * FROM persist_clone_alert_urlscan(1, 'scan-1', '{}'::jsonb, $1, NULL)", [classification]);
const row = async () => (await db.query<Record<string, unknown>>("SELECT * FROM shopfront_clone_alerts WHERE id=1")).rows[0];
const pending = async () => (await db.query("SELECT * FROM list_clone_alerts_pending_urlscan_retrieve(40,10,3)")).rows;

describe("scan completion SQL", () => {
  it("keeps failed rescans eligible while preserving the last verdict and clock", async () => {
    const before = await row();
    await persist(null);
    expect((await row()).urlscan_scanned_at).toEqual(before.urlscan_scanned_at);
    expect((await row()).urlscan_classification).toBe("neutral");
    expect(await pending()).toHaveLength(1);
    await persist(null); await persist(null);
    expect(await pending()).toHaveLength(0); // bounded failure streak still works
  });
  it("completes classification, lifecycle and archive together, idempotently", async () => {
    await persist("likely_phishing");
    const first = await row();
    expect(first.lifecycle_state).toBe("weaponised");
    expect(first.weaponised_at).not.toBeNull();
    expect(await pending()).toHaveLength(0);
    await persist("likely_phishing");
    expect((await row()).weaponised_at).toEqual(first.weaponised_at);
    expect((await db.query("SELECT * FROM clone_watch_scan_transitions")).rows).toHaveLength(1);
  });
  it("rolls back classification and archive when lifecycle writing fails", async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION reject_weaponisation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.lifecycle_state = 'weaponised' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_lifecycle BEFORE UPDATE ON shopfront_clone_alerts FOR EACH ROW EXECUTE FUNCTION reject_weaponisation();`);
    await expect(persist("likely_phishing")).rejects.toThrow("injected failure");
    expect((await row()).urlscan_classification).toBe("neutral");
    expect(await pending()).toHaveLength(1);
    expect((await db.query("SELECT * FROM clone_watch_scan_transitions")).rows).toHaveLength(0);
  });
  it("recovers legacy failed rescans without rewriting their historical clock", async () => {
    await db.exec(`UPDATE shopfront_clone_alerts SET urlscan_scanned_at=now(),
      urlscan_evidence='{"stage":"retrieve_pending","reputation":{"is_malicious":false}}'`);
    expect(await pending()).toHaveLength(1);
    await db.exec(`UPDATE shopfront_clone_alerts SET urlscan_evidence='{"stage":"retrieve_pending","reputation":{"is_malicious":true}}'`);
    expect(await pending()).toHaveLength(0);
  });
  it("does not resurrect terminal cases", async () => {
    await db.exec("UPDATE shopfront_clone_alerts SET lifecycle_state='taken_down'");
    await persist("likely_phishing");
    expect((await row()).lifecycle_state).toBe("taken_down");
  });
  it("can be applied again without changing data", async () => {
    await db.exec(migration("migration-v307-clone-scan-atomic-completion.sql"));
    expect((await row()).lifecycle_state).toBe("monitoring");
  });
});
