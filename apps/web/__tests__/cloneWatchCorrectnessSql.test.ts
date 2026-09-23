import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// v320 run for real (PGlite), on top of the v315 trigger it corrects. Each
// case below was a live defect: a JSON-array registrar pinned as its JSON text,
// an unparseable date raising INSIDE the AFTER UPDATE trigger (rolling back the
// enrichment write that fired it), a one-way confidence drop, a parent-zone
// createdDate, a retried apply step double-counting unchanged_reads, and a
// shared cap counting a deleted feature.
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    SET check_function_bodies = off;
    CREATE TABLE shopfront_clone_alerts (
      id bigint PRIMARY KEY, attribution jsonb, lifecycle_state text,
      submitted_to jsonb DEFAULT '{}', first_seen_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE scam_urls (
      id bigint PRIMARY KEY, whois_registrar text, whois_created_date date,
      whois_registrant_country text, whois_name_servers text[],
      whois_lookup_at timestamptz, confidence_level text, feed_sources text[],
      is_active boolean DEFAULT true, last_seen_in_feed timestamptz
    );
    CREATE TABLE cost_telemetry (
      created_at timestamptz DEFAULT now(), feature text, operation text, units numeric
    );
  `);
  await db.exec(migration("migration-v315-clone-attribution-platform-projection.sql"));
  await db.exec(migration("migration-v320-clone-watch-correctness.sql"));
}, 30_000);
afterAll(async () => db?.close());

beforeEach(async () => {
  await db.exec(`
    DELETE FROM shopfront_clone_alerts; DELETE FROM scam_urls; DELETE FROM cost_telemetry;
    INSERT INTO scam_urls (id, confidence_level, feed_sources, is_active)
      VALUES (10, 'high', ARRAY['clone_watch'], true);
    INSERT INTO shopfront_clone_alerts (id, attribution, lifecycle_state, submitted_to, first_seen_at)
      VALUES (1, NULL, 'weaponised', '{"platform_entity":{"scam_url_id":10}}', '2026-09-01');
  `);
});

const url = async () =>
  (await db.query<Record<string, unknown>>("SELECT * FROM scam_urls WHERE id = 10")).rows[0];
const enrich = (attribution: unknown) =>
  db.query("UPDATE shopfront_clone_alerts SET attribution = $1 WHERE id = 1", [
    JSON.stringify(attribution),
  ]);

describe("project_clone_to_platform_entity (v320)", () => {
  it("takes the first non-empty entry of a list-valued registrar", async () => {
    await enrich({ whois: { registrar: ["", "GoDaddy.com, LLC", "Reseller"] } });
    expect((await url()).whois_registrar).toBe("GoDaddy.com, LLC");
  });

  it("an unparseable date never rolls back the enrichment write", async () => {
    await enrich({
      whois: { registrar: "NameCheap", createdDate: "2024-13-45" },
      enriched_at: "not-a-time",
    });
    const alert = (await db.query<{ attribution: unknown }>(
      "SELECT attribution FROM shopfront_clone_alerts WHERE id = 1",
    )).rows[0];
    expect(alert.attribution).not.toBeNull(); // the trigger did not abort the UPDATE
    const u = await url();
    expect(u.whois_registrar).toBe("NameCheap");
    expect(u.whois_created_date).toBeNull();
    expect(u.whois_lookup_at).toBeNull();
  });

  it("treats a createdDate >1 year before first_seen_at as a parent-zone date", async () => {
    await enrich({ whois: { createdDate: "1997-05-01" } });
    expect((await url()).whois_created_date).toBeNull();
    await db.exec("UPDATE scam_urls SET whois_created_date = NULL");
    await enrich({ whois: { createdDate: "2026-08-30T00:00:00Z" } });
    expect((await url()).whois_created_date).toEqual(new Date("2026-08-30T00:00:00Z"));
  });

  it("drops to medium on takedown and returns to high (and active) on re-weaponisation", async () => {
    await db.exec("UPDATE shopfront_clone_alerts SET lifecycle_state = 'taken_down' WHERE id = 1");
    expect((await url()).confidence_level).toBe("medium");
    await db.exec("UPDATE scam_urls SET is_active = false");
    await db.exec("UPDATE shopfront_clone_alerts SET lifecycle_state = 'weaponised' WHERE id = 1");
    const u = await url();
    expect(u.confidence_level).toBe("high");
    expect(u.is_active).toBe(true);
  });

  it("never raises a row another feed also carries", async () => {
    await db.exec(`UPDATE scam_urls SET confidence_level = 'medium',
                   feed_sources = ARRAY['clone_watch','openphish']`);
    await db.exec("UPDATE shopfront_clone_alerts SET lifecycle_state = 'monitoring' WHERE id = 1");
    await db.exec("UPDATE shopfront_clone_alerts SET lifecycle_state = 'weaponised' WHERE id = 1");
    expect((await url()).confidence_level).toBe("medium");
  });

  it("does not project onto a retracted Platform Entity", async () => {
    await db.exec(`UPDATE shopfront_clone_alerts SET submitted_to =
      '{"platform_entity":{"scam_url_id":10,"retracted_at":"2026-09-20"}}' WHERE id = 1`);
    await enrich({ whois: { registrar: "NameCheap" } });
    expect((await url()).whois_registrar).toBeNull();
  });

  it("re-applying the migration repairs a pinned array registrar and parent-zone date", async () => {
    await db.exec(`UPDATE shopfront_clone_alerts SET attribution =
      '{"whois":{"registrar":["GoDaddy.com, LLC","Reseller"],"createdDate":"1997-05-01"}}' WHERE id = 1`);
    // What v315 left behind in prod.
    await db.exec(`UPDATE scam_urls SET whois_registrar = '["GoDaddy.com, LLC", "Reseller"]',
                   whois_created_date = '1997-05-01'`);
    await db.exec(migration("migration-v320-clone-watch-correctness.sql"));
    const u = await url();
    expect(u.whois_registrar).toBe("GoDaddy.com, LLC");
    expect(u.whois_created_date).toBeNull();
  });
});

describe("record_netcraft_url_verdicts (v320)", () => {
  const apply = () =>
    db.query("SELECT record_netcraft_url_verdicts($1::jsonb) AS n", [
      JSON.stringify([{ id: 1, url_state: "no threats" }]),
    ]);
  const reads = async () =>
    (await db.query<{ n: string | null }>(
      "SELECT submitted_to->'netcraft'->>'unchanged_reads' AS n FROM shopfront_clone_alerts WHERE id = 1",
    )).rows[0].n;

  it("a retried apply of the same read does not double-count", async () => {
    await db.exec(`UPDATE shopfront_clone_alerts SET submitted_to = jsonb_build_object('netcraft',
      jsonb_build_object('url_state','no threats','unchanged_reads',2,
                         'url_state_at',(now() - interval '13 hours')::text)) WHERE id = 1`);
    await apply();
    expect(await reads()).toBe("3");
    await apply(); // the retried step
    expect(await reads()).toBe("3");
  });

  it("a changed verdict still resets to 0", async () => {
    await db.exec(`UPDATE shopfront_clone_alerts SET submitted_to = jsonb_build_object('netcraft',
      jsonb_build_object('url_state','malicious','unchanged_reads',5,
                         'url_state_at',now()::text)) WHERE id = 1`);
    await apply();
    expect(await reads()).toBe("0");
  });
});

describe("count_todays_takedown_submissions (v320)", () => {
  it("counts blocklist + abuse sends, not Netcraft or the deleted lane", async () => {
    await db.exec(`INSERT INTO cost_telemetry (feature, operation, units) VALUES
      ('clone_enforcement','enforcement.queued',2),
      ('clone_enforcement','enforcement.reported',1),
      ('clone_enforcement','enforcement.actioned',1),
      ('shopfront_clone_netcraft_auto','bulk_submit',30),
      ('shopfront_clone_submit_netcraft','submit',1)`);
    const r = await db.query<{ n: number }>("SELECT count_todays_takedown_submissions() AS n");
    expect(r.rows[0].n).toBe(3);
  });
});
