import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Runs the REAL v329 SQL (#1234) against PGlite: the takedown clock, the
 * weaponised liveness sweep, and the no-threat-on-phishing escalation.
 *
 * Every fixture below is shaped on a prod row measured 2026-09-26, not
 * invented: alert 4327 (weaponised 12:11:10, OUR submitted_at 13:03:26,
 * Netcraft's log dated malicious 13:01:16 — v145 read that as −2 min).
 *
 * GO-RED (each verified by reverting the named line in the migration, running
 * this file, seeing the named test fail, and restoring):
 *   - triage latency back on OUR clock (`takedown_at - submitted_at` in the
 *     `triage` CTE) → "never reports a negative takedown time" fails (−2).
 *   - COALESCE(..., 0) around median_minutes → "reports NULL, not 0" fails.
 *   - confirm window dropped (`offline_since <= now()` instead of − 12 h) →
 *     "a second NXDOMAIN inside 12 h does not confirm" fails.
 *   - `present` no longer clearing offline_since → "a resolving read resets"
 *     fails.
 *   - the `issue_reported_at >= submitted_at` term removed from
 *     netcraft_vendor_gap_basis → "an issue on an EARLIER submission" fails.
 */

const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE shopfront_clone_alerts (
      id bigint PRIMARY KEY,
      candidate_domain text,
      source text DEFAULT 'nrd',
      lifecycle_state text DEFAULT 'weaponised',
      alert_state text DEFAULT 'open',
      triage_status text DEFAULT 'pending',
      submitted_to jsonb,
      weaponised_at timestamptz,
      target_brand_normalized text,
      inferred_target_domain text,
      updated_at timestamptz DEFAULT now(),
      -- v288, verbatim: the sweep must satisfy it or the write fails.
      CONSTRAINT clone_alert_terminal_state_sync CHECK (
        lifecycle_state NOT IN ('taken_down', 'dormant')
        OR alert_state IN ('taken_down', 'expired'))
    );
  `);
  await db.exec(
    migration("migration-v329-takedown-metrics-on-vendor-clock.sql"),
  );
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () => db.exec("DELETE FROM shopfront_clone_alerts"));

const iso = (d: Date) => d.toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function insert(row: {
  id: number;
  lifecycle?: string;
  alertState?: string;
  weaponisedAt?: Date | null;
  submittedTo?: unknown;
  offlineSince?: Date | null;
  livenessCheckedAt?: Date | null;
  triage?: string;
}) {
  await db.query(
    `INSERT INTO shopfront_clone_alerts
       (id, candidate_domain, lifecycle_state, alert_state, weaponised_at,
        submitted_to, offline_since, liveness_checked_at, triage_status,
        target_brand_normalized)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 'Brand')`,
    [
      row.id,
      `d${row.id}.example`,
      row.lifecycle ?? "weaponised",
      row.alertState ??
        (row.lifecycle === "taken_down" ? "taken_down" : "open"),
      row.weaponisedAt ? iso(row.weaponisedAt) : null,
      row.submittedTo === undefined ? null : JSON.stringify(row.submittedTo),
      row.offlineSince ? iso(row.offlineSince) : null,
      row.livenessCheckedAt ? iso(row.livenessCheckedAt) : null,
      row.triage ?? "pending",
    ],
  );
}

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0]!;

describe("record_netcraft_url_verdicts persists Netcraft's receipt clock", () => {
  it("stores received_at, and pairs takedown_at with the same submission's receipt", async () => {
    const received = ago(90);
    const ours = new Date(received.getTime() + 107_000); // ours trails by 107 s (measured max 142 s)
    const malicious = new Date(received.getTime() + 20_000); // inside the gap
    await insert({
      id: 1,
      submittedTo: { netcraft: { uuid: "u1", submitted_at: iso(ours) } },
    });
    await db.query("SELECT record_netcraft_url_verdicts($1::jsonb)", [
      JSON.stringify([
        {
          id: 1,
          url_state: "malicious",
          reason: null,
          malicious_at: iso(malicious),
          netcraft_submitted_at: iso(received),
        },
      ]),
    ]);
    const nc = (
      await one<{ nc: Record<string, string> }>(
        "SELECT submitted_to->'netcraft' AS nc FROM shopfront_clone_alerts WHERE id=1",
      )
    ).nc;
    expect(Date.parse(nc.received_at!)).toBe(received.getTime());
    expect(Date.parse(nc.takedown_received_at!)).toBe(received.getTime());
    expect(Date.parse(nc.takedown_at!)).toBe(malicious.getTime());
    expect(nc.takedown_at_source).toBe("netcraft_log");
  });
});

describe("clone_watch_takedown_stats — one clock per duration", () => {
  it("never reports a negative takedown time (alert 4327's shape)", async () => {
    const weaponised = ago(24 * 60);
    const received = new Date(weaponised.getTime() + 50 * 60_000); // Netcraft receipt
    const malicious = new Date(received.getTime() + 11_000); // 11 s later on Netcraft's clock
    const ours = new Date(received.getTime() + 130_000); // our stamp trails by 130 s
    await insert({
      id: 4327,
      lifecycle: "taken_down",
      weaponisedAt: weaponised,
      submittedTo: {
        netcraft: {
          submitted_at: iso(ours),
          takedown_at: iso(malicious),
          takedown_at_source: "netcraft_log",
          takedown_received_at: iso(received),
        },
      },
    });
    const s = await one<Record<string, number | null>>(
      "SELECT * FROM clone_watch_takedown_stats(30)",
    );
    expect(Number(s.takedowns_total)).toBe(1);
    expect(Number(s.timed_n)).toBe(1);
    expect(s.median_minutes).toBe(0); // 11 s, both on Netcraft's clock
    expect(s.fastest_minutes).toBeGreaterThanOrEqual(0);
    // weaponised → blocklisted: 50 min, the number the public page shows.
    expect(Number(s.detect_to_block_n)).toBe(1);
    expect(s.detect_to_block_median_minutes).toBe(50);
  });

  it("reports NULL, not 0, when no row carries both ends of a clock", async () => {
    // A pre-v329 vendor stamp: no takedown_received_at yet.
    await insert({
      id: 1,
      lifecycle: "taken_down",
      weaponisedAt: ago(300),
      submittedTo: {
        netcraft: {
          submitted_at: iso(ago(100)),
          takedown_at: iso(ago(102)),
          takedown_at_source: "netcraft_log",
        },
      },
    });
    const s = await one<Record<string, number | null>>(
      "SELECT * FROM clone_watch_takedown_stats(30)",
    );
    expect(Number(s.takedowns_total)).toBe(1);
    expect(Number(s.timed_n)).toBe(0);
    expect(s.median_minutes).toBeNull();
    expect(s.p90_minutes).toBeNull();
    expect(s.fastest_minutes).toBeNull();
  });

  it("counts a site Netcraft blocked before we saw it phishing — never averages it in", async () => {
    await insert({
      id: 1,
      lifecycle: "taken_down",
      weaponisedAt: ago(60), // we saw phishing AFTER Netcraft had blocked it
      submittedTo: {
        netcraft: {
          takedown_at: iso(ago(120)),
          takedown_at_source: "netcraft_log",
        },
      },
    });
    const s = await one<Record<string, number | null>>(
      "SELECT * FROM clone_watch_takedown_stats(30)",
    );
    expect(Number(s.blocked_before_detection)).toBe(1);
    expect(Number(s.detect_to_block_n)).toBe(0);
    expect(s.detect_to_block_median_minutes).toBeNull();
  });

  it("excludes a v219 witnessed stamp (our first look) from the detection duration", async () => {
    await insert({
      id: 1,
      lifecycle: "taken_down",
      weaponisedAt: ago(3000),
      submittedTo: { netcraft: { takedown_at: iso(ago(10)) } }, // no source = witnessed
    });
    const s = await one<Record<string, number | null>>(
      "SELECT * FROM clone_watch_takedown_stats(30)",
    );
    expect(Number(s.takedowns_total)).toBe(1);
    expect(Number(s.detect_to_block_n)).toBe(0);
  });

  it("splits the weaponised cohort by where each clone is now", async () => {
    const w = ago(5 * 24 * 60);
    await insert({
      id: 1,
      lifecycle: "taken_down",
      weaponisedAt: w,
      submittedTo: {},
    });
    await insert({
      id: 2,
      lifecycle: "dormant",
      alertState: "expired",
      weaponisedAt: w,
      offlineSince: new Date(w.getTime() + 120 * 60_000),
    });
    await insert({
      id: 3,
      weaponisedAt: w,
      submittedTo: {
        netcraft: { url_state: "no threats" },
        vendor_gap: { escalated_at: iso(ago(1)) },
      },
    });
    await insert({
      id: 4,
      weaponisedAt: w,
      submittedTo: { netcraft: { url_state: "unavailable" } },
    });
    await insert({ id: 5, weaponisedAt: ago(40 * 24 * 60) }); // outside the window
    const s = await one<Record<string, number | null>>(
      "SELECT * FROM clone_watch_takedown_stats(30)",
    );
    expect(Number(s.weaponised_n)).toBe(4);
    expect(Number(s.weaponised_blocklisted)).toBe(1);
    expect(Number(s.weaponised_offline)).toBe(1);
    expect(Number(s.weaponised_open)).toBe(2);
    expect(Number(s.weaponised_vendor_gap)).toBe(2);
    expect(Number(s.weaponised_escalated)).toBe(1);
    expect(s.detect_to_offline_median_minutes).toBe(120);
  });
});

describe("weaponised liveness sweep", () => {
  const record = async (results: unknown[]) =>
    one<Record<string, number>>(
      "SELECT * FROM record_weaponised_liveness($1::jsonb, 12)",
      [JSON.stringify(results)],
    );
  const state = async (id: number) =>
    one<{
      lifecycle_state: string;
      alert_state: string;
      offline_since: string | null;
      liveness_checked_at: string | null;
    }>(
      "SELECT lifecycle_state, alert_state, offline_since, liveness_checked_at FROM shopfront_clone_alerts WHERE id=$1",
      [id],
    );

  it("a first NXDOMAIN starts the clock but does not move the alert", async () => {
    await insert({ id: 1 });
    const r = await record([{ id: 1, gone: true }]);
    expect(r).toMatchObject({
      checked: 1,
      gone_unconfirmed: 1,
      offline_confirmed: 0,
    });
    const s = await state(1);
    expect(s.lifecycle_state).toBe("weaponised");
    expect(s.offline_since).not.toBeNull();
    expect(s.liveness_checked_at).not.toBeNull();
  });

  it("a second NXDOMAIN >= 12 h later confirms: weaponised → dormant, alert_state expired", async () => {
    const first = ago(13 * 60);
    await insert({ id: 1, offlineSince: first });
    const r = await record([{ id: 1, gone: true }]);
    expect(r.offline_confirmed).toBe(1);
    const s = await state(1);
    expect(s.lifecycle_state).toBe("dormant");
    expect(s.alert_state).toBe("expired");
    // The witnessed offline time is the FIRST observation, not the confirming one.
    expect(new Date(s.offline_since!).getTime()).toBe(first.getTime());
  });

  it("a second NXDOMAIN inside 12 h does not confirm (a retried step)", async () => {
    await insert({ id: 1, offlineSince: ago(60) });
    const r = await record([{ id: 1, gone: true }]);
    expect(r).toMatchObject({ gone_unconfirmed: 1, offline_confirmed: 0 });
    expect((await state(1)).lifecycle_state).toBe("weaponised");
  });

  it("a resolving read resets the clock", async () => {
    await insert({ id: 1, offlineSince: ago(13 * 60) });
    const r = await record([{ id: 1, gone: false }]);
    expect(r.present).toBe(1);
    const s = await state(1);
    expect(s.offline_since).toBeNull();
    expect(s.lifecycle_state).toBe("weaponised");
  });

  it("an inconclusive read neither resets nor confirms", async () => {
    const first = ago(13 * 60);
    await insert({ id: 1, offlineSince: first });
    const r = await record([{ id: 1, gone: null }]);
    expect(r).toMatchObject({ inconclusive: 1, offline_confirmed: 0 });
    const s = await state(1);
    expect(s.lifecycle_state).toBe("weaponised");
    expect(new Date(s.offline_since!).getTime()).toBe(first.getTime());
  });

  it("never touches an alert that left weaponised (a Netcraft takedown wins)", async () => {
    await insert({
      id: 1,
      lifecycle: "taken_down",
      offlineSince: ago(13 * 60),
    });
    const r = await record([{ id: 1, gone: true }]);
    expect(r.checked).toBe(0);
    expect((await state(1)).lifecycle_state).toBe("taken_down");
  });

  it("the worklist is NULL-first, cadence-gated, and counts what the LIMIT cut", async () => {
    await insert({ id: 1, livenessCheckedAt: ago(30) }); // read 30 min ago → not due
    await insert({ id: 2, livenessCheckedAt: ago(21 * 60) }); // due
    await insert({ id: 3 }); // never read → first
    await insert({ id: 4 });
    await insert({ id: 5, lifecycle: "declined" }); // not weaponised
    const rows = (
      await db.query<{ id: number; due_total: number }>(
        "SELECT id, due_total FROM list_weaponised_for_liveness(2, 20)",
      )
    ).rows;
    expect(rows.map((r) => Number(r.id))).toEqual([3, 4]);
    expect(rows.every((r) => Number(r.due_total) === 3)).toBe(true);
  });
});

describe("no-threat-on-phishing escalation", () => {
  const list = async () =>
    (
      await db.query<{ id: number; basis: string }>(
        "SELECT id, basis FROM list_netcraft_vendor_gap(72, 50)",
      )
    ).rows.map((r) => ({ id: Number(r.id), basis: r.basis }));

  it("escalates an explicit Netcraft rejection", async () => {
    await insert({
      id: 1,
      weaponisedAt: ago(100),
      submittedTo: {
        netcraft: {
          url_state: "no threats",
          url_state_reason: "Already reported and rejected.",
        },
      },
    });
    expect(await list()).toEqual([{ id: 1, basis: "rejected" }]);
  });

  it("escalates an issue on the CURRENT submission only after 72 h and a later read", async () => {
    const submitted = ago(100 * 60);
    const issue = ago(90 * 60);
    await insert({
      id: 1,
      weaponisedAt: ago(110 * 60),
      submittedTo: {
        netcraft: {
          url_state: "no threats",
          submitted_at: iso(submitted),
          url_state_at: iso(ago(10)),
        },
        netcraft_issue: { issue_reported_at: iso(issue) },
      },
    });
    // Issue filed only 20 h ago, read since → too soon.
    await insert({
      id: 2,
      weaponisedAt: ago(30 * 60),
      submittedTo: {
        netcraft: {
          url_state: "no threats",
          submitted_at: iso(ago(25 * 60)),
          url_state_at: iso(ago(10)),
        },
        netcraft_issue: { issue_reported_at: iso(ago(20 * 60)) },
      },
    });
    // Issue old enough, but no verdict read after the wait.
    await insert({
      id: 3,
      weaponisedAt: ago(110 * 60),
      submittedTo: {
        netcraft: {
          url_state: "no threats",
          submitted_at: iso(submitted),
          url_state_at: iso(ago(80 * 60)),
        },
        netcraft_issue: { issue_reported_at: iso(issue) },
      },
    });
    expect(await list()).toEqual([{ id: 1, basis: "issue_unanswered" }]);
  });

  it("does not escalate an issue on an EARLIER submission (resubmitted since)", async () => {
    await insert({
      id: 1,
      weaponisedAt: ago(200 * 60),
      submittedTo: {
        netcraft: {
          url_state: "no threats",
          submitted_at: iso(ago(80 * 60)),
          url_state_at: iso(ago(1)),
        },
        netcraft_issue: { issue_reported_at: iso(ago(150 * 60)) },
      },
    });
    expect(await list()).toEqual([]);
  });

  it("leaves a site the sweep saw vanish, an fp, and a malicious verdict alone", async () => {
    const rejected = {
      netcraft: {
        url_state: "no threats",
        url_state_reason: "Already reported and rejected.",
      },
    };
    await insert({ id: 1, submittedTo: rejected, offlineSince: ago(10) });
    await insert({ id: 2, submittedTo: rejected, triage: "fp" });
    await insert({
      id: 3,
      submittedTo: { netcraft: { url_state: "malicious" } },
    });
    expect(await list()).toEqual([]);
  });

  it("stamps once per alert, and mark re-checks the predicate at write time", async () => {
    const rejected = {
      netcraft: {
        url_state: "no threats",
        url_state_reason: "Already reported and rejected.",
        uuid: "u9",
      },
    };
    await insert({ id: 1, submittedTo: rejected });
    await insert({
      id: 2,
      submittedTo: { netcraft: { url_state: "malicious" } },
    });
    const n1 = await one<{ n: number }>(
      "SELECT mark_netcraft_vendor_gap_escalated(ARRAY[1,2]::bigint[], 72) AS n",
    );
    expect(n1.n).toBe(1); // id 2 no longer qualifies
    const n2 = await one<{ n: number }>(
      "SELECT mark_netcraft_vendor_gap_escalated(ARRAY[1]::bigint[], 72) AS n",
    );
    expect(n2.n).toBe(0);
    expect(await list()).toEqual([]);
    const vg = (
      await one<{ vg: Record<string, string> }>(
        "SELECT submitted_to->'vendor_gap' AS vg FROM shopfront_clone_alerts WHERE id=1",
      )
    ).vg;
    expect(vg).toMatchObject({
      basis: "rejected",
      escalated_to: "operator",
      netcraft_uuid: "u9",
    });
  });
});
