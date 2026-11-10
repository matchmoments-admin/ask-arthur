import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// v343 (#1297) run for real (PGlite): the submit DNS precheck is stored in
// `dns_precheck` / `dns_precheck_at`, not as a fake urlscan 400, and every
// worklist that keyed off the fake 400 now reads `clone_alert_dns_dead`.
// Worklist-gate-starvation rule: each gate change below has a rotation case
// (a held row comes back once its cadence lapses) and a NULL case (a row with
// no reading is never hidden).
//
// Go-red (2026-10-13): this file run against the PRE-v343 bodies (v272 writer,
// v334 recheck, v326 count, v325 reset, v315 submit, v293 stranded — loaded
// over a table that already had the two columns) failed 7 of 11: every
// "precheck-dead" hold case (a dns_precheck = no_host row with no 400 in its
// evidence read as live), the stranded case, and both writer cases (no 4-arg
// signature). The recheck rotation case and the three legacy/NULL cases passed
// there too — they pin behaviour v343 must keep, not the change.
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
      urlscan_scanned_at timestamptz, urlscan_submitted_at timestamptz,
      recheck_dns_fingerprint text, recheck_dns_checked_at timestamptz
    );
    CREATE TABLE clone_watch_classifications (
      alert_id bigint PRIMARY KEY, is_clone boolean, confidence real, attack_intent text,
      clone_tactic text
    );
    CREATE TABLE known_brands (brand_domain text, brand_category text);
    CREATE TABLE clone_watch_not_a_clone_samples (alert_id bigint PRIMARY KEY);
  `);
  await db.exec(migration("migration-v343-clone-dns-precheck-column.sql"));
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () =>
  db.exec(
    "DELETE FROM shopfront_clone_alerts; DELETE FROM clone_watch_classifications",
  ),
);

type Row = {
  id: number;
  uuid?: string | null;
  streak?: number;
  evidence?: Record<string, unknown> | null;
  dns?: string | null;
  dnsHoursAgo?: number;
  lastHoursAgo?: number | null;
  lifecycle?: string;
  classification?: string | null;
};
async function insert(r: Row) {
  await db.query(
    `INSERT INTO shopfront_clone_alerts
       (id, candidate_domain, candidate_url, urlscan_uuid, urlscan_failure_streak,
        urlscan_evidence, dns_precheck, dns_precheck_at, last_rechecked_at,
        lifecycle_state, urlscan_classification)
     VALUES ($1, $2, 'https://' || $2, $3, $4, $5::jsonb, $6,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() - make_interval(hours => $7::int) END,
       CASE WHEN $8::int IS NULL THEN NULL ELSE now() - make_interval(hours => $8::int) END,
       $9, $10)`,
    [
      r.id,
      `d${r.id}.example`,
      r.uuid ?? null,
      r.streak ?? 0,
      r.evidence ? JSON.stringify(r.evidence) : null,
      r.dns ?? null,
      r.dnsHoursAgo ?? 1,
      r.lastHoursAgo ?? null,
      r.lifecycle ?? "declined",
      r.classification ?? null,
    ],
  );
  await db.query(
    "INSERT INTO clone_watch_classifications (alert_id, is_clone, confidence) VALUES ($1, true, 0.9)",
    [r.id],
  );
}
const ids = (rows: { id: number }[]) =>
  rows.map((r) => Number(r.id)).sort((a, b) => a - b);
const recheckDue = async () =>
  ids(
    (
      await db.query<{ id: number }>(
        "SELECT id FROM list_clone_alerts_for_recheck(500, 6, 168)",
      )
    ).rows,
  );
const submitDue = async () =>
  ids(
    (
      await db.query<{ id: number }>(
        "SELECT id FROM list_clone_alerts_pending_urlscan_submit(100, 0.4, 3, 168)",
      )
    ).rows,
  );
const dormant = async () =>
  (
    await db.query<{ n: number }>(
      "SELECT count_clone_recheck_dormant_dead() AS n",
    )
  ).rows[0]!.n;
const alert = async (id: number) =>
  (
    await db.query<Record<string, unknown>>(
      "SELECT * FROM shopfront_clone_alerts WHERE id = $1",
      [id],
    )
  ).rows[0]!;

const RENDER = {
  uuid: "scan-1",
  retrieved: true,
  screenshot_url: "https://urlscan.io/s.png",
};

describe("record_clone_alert_urlscan_submit (v343)", () => {
  it("a precheck skip keeps the retrieved render, records the reading, bumps the streak", async () => {
    await insert({ id: 1, uuid: "scan-1", evidence: RENDER, streak: 0 });
    await db.query(
      "SELECT record_clone_alert_urlscan_submit(p_alert_id => 1, p_urlscan_uuid => NULL, p_evidence => NULL, p_dns_precheck => 'no_host')",
    );
    const a = await alert(1);
    expect(a.urlscan_evidence).toEqual(RENDER);
    expect(a.urlscan_uuid).toBe("scan-1");
    expect(a.dns_precheck).toBe("no_host");
    expect(a.dns_precheck_at).not.toBeNull();
    expect(a.urlscan_failure_streak).toBe(1);
  });

  it("a live reading on a real submit clears the dead one; a NULL reading keeps it", async () => {
    await insert({ id: 1, dns: "no_host", dnsHoursAgo: 200 });
    await db.query(
      "SELECT record_clone_alert_urlscan_submit(p_alert_id => 1, p_urlscan_uuid => NULL, p_evidence => '{\"status\":429}'::jsonb)",
    );
    expect((await alert(1)).dns_precheck).toBe("no_host");
    await db.query(
      "SELECT record_clone_alert_urlscan_submit(p_alert_id => 1, p_urlscan_uuid => 'scan-9', p_evidence => '{\"uuid\":\"scan-9\"}'::jsonb, p_dns_precheck => 'host')",
    );
    const a = await alert(1);
    expect(a.dns_precheck).toBe("host");
    expect(a.urlscan_failure_streak).toBe(0);
  });
});

describe("list_clone_alerts_for_recheck (v343)", () => {
  it("a precheck-dead row with no 400 in its evidence is on the 168 h cadence", async () => {
    await insert({
      id: 1,
      uuid: "scan-1",
      evidence: RENDER,
      dns: "no_host",
      lastHoursAgo: 12,
    });
    await insert({
      id: 2,
      uuid: "scan-2",
      evidence: RENDER,
      dns: "host",
      lastHoursAgo: 12,
    });
    expect(await recheckDue()).toEqual([2]);
  });

  it("rotation: the precheck-dead row returns once 168 h lapse", async () => {
    await insert({
      id: 1,
      uuid: "scan-1",
      evidence: RENDER,
      dns: "servfail",
      lastHoursAgo: 170,
    });
    expect(await recheckDue()).toEqual([1]);
  });

  it("dead-dormancy holds out a never-scanned precheck-dead row at streak 8, and counts it", async () => {
    await insert({ id: 1, streak: 8, dns: "no_host" });
    await insert({ id: 2, streak: 7, dns: "no_host" });
    await insert({ id: 3, streak: 12, dns: "host" }); // a live reading is never dormant
    expect(await recheckDue()).toEqual([2, 3]);
    expect(await dormant()).toBe(1);
    const reset = await db.query<{ ids: number[] }>(
      "SELECT reset_clone_alert_dead_dormancy(ARRAY[1, 2, 3]::bigint[]) AS ids",
    );
    expect(reset.rows[0]!.ids.map(Number)).toEqual([1]);
  });

  it("legacy: a pre-v343 fake 400 (no reading) is read exactly as before", async () => {
    await insert({
      id: 1,
      streak: 8,
      evidence: { status: 400, error: "dns_no_host_precheck" },
    });
    await insert({
      id: 2,
      uuid: "s",
      evidence: { status: 400 },
      lastHoursAgo: 12,
    });
    expect(await recheckDue()).toEqual([]);
    expect(await dormant()).toBe(1);
    const reset = await db.query<{ ids: number[] }>(
      "SELECT reset_clone_alert_dead_dormancy(ARRAY[1, 2]::bigint[]) AS ids",
    );
    expect(reset.rows[0]!.ids.map(Number)).toEqual([1]);
  });

  it("NULL-safe: a row with neither reading is live (6 h), never hidden", async () => {
    await insert({ id: 1, streak: 20, lastHoursAgo: 7 });
    expect(await recheckDue()).toEqual([1]);
    expect(await dormant()).toBe(0);
  });
});

describe("list_clone_alerts_pending_urlscan_submit (v343)", () => {
  it("a precheck-dead row bypasses the 3-strike rule and waits out 168 h from dns_precheck_at", async () => {
    await insert({ id: 1, streak: 5, dns: "no_host", dnsHoursAgo: 10 }); // too soon
    await insert({ id: 2, streak: 5, dns: "no_host", dnsHoursAgo: 200 }); // rotation: due again
    await insert({ id: 3, streak: 5, dns: "host" }); // live + 3 strikes → out
    await insert({ id: 4, streak: 0, dns: "host" }); // live, fresh → in
    expect(await submitDue()).toEqual([2, 4]);
  });

  it("the dead clock is the LATER reading: a fresh precheck beats an old urlscan 400", async () => {
    await insert({
      id: 1,
      streak: 5,
      dns: "no_host",
      dnsHoursAgo: 10,
      evidence: {
        status: 400,
        attempted_at: new Date(Date.now() - 300 * 3600e3).toISOString(),
      },
    });
    expect(await submitDue()).toEqual([]);
  });

  it("legacy + NULL: a fake 400 still uses its attempted_at; a row with no reading keeps the 3-strike rule", async () => {
    const old = new Date(Date.now() - 200 * 3600e3).toISOString();
    await insert({
      id: 1,
      streak: 5,
      evidence: { status: 400, attempted_at: old },
    });
    await insert({ id: 2, streak: 5 });
    await insert({ id: 3, streak: 1 });
    expect(await submitDue()).toEqual([1, 3]);
  });
});

describe("clone_watch_urlscan_stranded_count (v343)", () => {
  it("a precheck-dead never-scanned row is retried by the submit lane, so not stranded", async () => {
    await insert({ id: 1, streak: 5, dns: "no_host", lifecycle: "detected" });
    await insert({ id: 2, streak: 5, dns: "host", lifecycle: "detected" });
    const r = await db.query<{ stranded_streak: number }>(
      "SELECT stranded_streak FROM clone_watch_urlscan_stranded_count(3)",
    );
    expect(Number(r.rows[0]!.stranded_streak)).toBe(1); // only the live-read row
  });
});
