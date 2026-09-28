import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isRegistryHold } from "@/lib/clone-watch/liveness";

/**
 * v341 — record_weaponised_liveness APPLIES the TS Domain DNS State verdict,
 * against the REAL SQL on PGlite (v329 then v341, the prod order).
 *
 * The defect (measured 2026-09-28 against prod's 144 swept names): 5
 * weaponised clones stored `present` answer NS but no A/AAAA. Under v329 such
 * a read re-emerged a dormant clone and counted in `stranded_live`; the
 * re-emergence monitor, month-end stock and v326 all require an address.
 *
 * Two databases: `v329` has only the old body, `v341` has both files applied.
 * "Old caller" cases run the SAME input through both and assert the SAME rows
 * and counts — the pin that v341 is safe before the code deploys.
 *
 * GO-RED (2026-09-28; each: edit the named line in migration-v341, run this
 * file, see the named test fail, restore):
 *   - dormant exit back on "anything not gone" (`r.verdict <> 'gone'` in the
 *     dormant CASE) → "a dormant clone whose NS answers but has no address
 *     stays dormant" fails (re_emerged 1).
 *   - verdict ignored (`r0.verdict_in` replaced by NULL) → "stores no_host,
 *     never present" fails (present).
 *   - fallback changed (`ELSE 'present'` → `ELSE 'no_host'`) → the old-caller
 *     parity tests fail on the gone:false fixtures, and "an unknown verdict
 *     string falls back…" fails.
 *   - `r.hold_in` dropped from the on_hold COALESCE → "the TS hold wins over
 *     the stored-RDAP regex" fails (registrar_hold).
 *   - 'no_host' removed from the CHECK → "stays dormant" and "stores no_host"
 *     fail with 23514.
 */

const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

const SCHEMA = `
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
    candidate_url text,
    urlscan_uuid text,
    attribution jsonb,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT clone_alert_terminal_state_sync CHECK (
      lifecycle_state NOT IN ('taken_down', 'dormant')
      OR alert_state IN ('taken_down', 'expired'))
  );
  -- v325's table, only so v341's corrected COMMENT has a target.
  CREATE TABLE clone_liveness_snapshots (status text);
`;

let v329: PGlite;
let v341: PGlite;
beforeAll(async () => {
  v329 = new PGlite();
  v341 = new PGlite();
  for (const db of [v329, v341]) {
    await db.exec(SCHEMA);
    await db.exec(migration("migration-v329-takedown-metrics-on-vendor-clock.sql"));
  }
  await v341.exec(migration("migration-v341-weaponised-liveness-applies-ts-verdict.sql"));
}, 60_000);
afterAll(async () => {
  await v329?.close();
  await v341?.close();
});
beforeEach(async () => {
  await v329.exec("DELETE FROM shopfront_clone_alerts");
  await v341.exec("DELETE FROM shopfront_clone_alerts");
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

interface Seed {
  id: number;
  lifecycle?: string;
  offlineSince?: string | null;
  statuses?: string[];
}

async function seed(db: PGlite, rows: Seed[]) {
  for (const r of rows) {
    const dormant = r.lifecycle === "dormant";
    await db.query(
      `INSERT INTO shopfront_clone_alerts
         (id, candidate_domain, lifecycle_state, alert_state, weaponised_at, offline_since, attribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        r.id,
        `d${r.id}.example`,
        r.lifecycle ?? "weaponised",
        dormant ? "expired" : "open",
        ago(30 * 24 * 60),
        r.offlineSince ?? (dormant ? ago(9 * 24 * 60) : null),
        r.statuses ? JSON.stringify({ whois: { statuses: r.statuses } }) : null,
      ],
    );
  }
}

const record = async (db: PGlite, results: unknown[]) =>
  (
    await db.query<Record<string, number>>(
      "SELECT * FROM record_weaponised_liveness($1::jsonb, 12)",
      [JSON.stringify(results)],
    )
  ).rows[0]!;

const rows = async (db: PGlite) =>
  (
    await db.query<Record<string, unknown>>(
      `SELECT id, lifecycle_state, alert_state, offline_since IS NOT NULL AS offline,
              offline_cause, liveness_last_verdict
         FROM shopfront_clone_alerts ORDER BY id`,
    )
  ).rows;

describe("v341 is safe before the code deploys (old caller: {id, gone} only)", () => {
  // Every branch of v329's recorder, as the pre-v341 sweep called it.
  const fixtures: Array<{ name: string; seed: Seed[]; reads: unknown[] }> = [
    {
      name: "weaponised: present / gone first / gone confirmed / pending / inconclusive",
      seed: [
        { id: 1 },
        { id: 2 },
        { id: 3, offlineSince: ago(13 * 60) },
        { id: 4, offlineSince: ago(60) },
        { id: 5 },
        { id: 6, offlineSince: ago(13 * 60), statuses: ["client hold"] },
      ],
      reads: [
        { id: 1, gone: false },
        { id: 2, gone: true },
        { id: 3, gone: true },
        { id: 4, gone: true },
        { id: 5, gone: null },
        { id: 6, gone: true },
      ],
    },
    {
      name: "dormant: resolves again / still gone / inconclusive",
      seed: [
        { id: 1, lifecycle: "dormant" },
        { id: 2, lifecycle: "dormant" },
        { id: 3, lifecycle: "dormant" },
      ],
      reads: [
        { id: 1, gone: false },
        { id: 2, gone: true },
        { id: 3, gone: null },
      ],
    },
  ];

  for (const f of fixtures) {
    it(f.name, async () => {
      await seed(v329, f.seed);
      await seed(v341, f.seed);
      const before = await record(v329, f.reads);
      const after = await record(v341, f.reads);
      const { no_host, ...afterV329Columns } = after;
      expect(afterV329Columns).toEqual(before);
      expect(no_host).toBe(0);
      expect(await rows(v341)).toEqual(await rows(v329));
    });
  }
});

describe("v341 applies the TS verdict (new caller)", () => {
  it("a dormant clone whose NS answers but has no address stays dormant", async () => {
    await seed(v341, [{ id: 1, lifecycle: "dormant" }]);
    // The TS sweep sends gone:false (the name exists) AND verdict no_host.
    const r = await record(v341, [{ id: 1, gone: false, verdict: "no_host", hold: false }]);
    expect(r).toMatchObject({ checked: 1, re_emerged: 0 });
    expect((await rows(v341))[0]).toMatchObject({
      lifecycle_state: "dormant",
      alert_state: "expired",
      liveness_last_verdict: "no_host",
    });
  });

  it("only an address brings a dormant clone back", async () => {
    await seed(v341, [{ id: 1, lifecycle: "dormant" }]);
    const r = await record(v341, [{ id: 1, gone: false, verdict: "present", hold: false }]);
    expect(r.re_emerged).toBe(1);
    expect((await rows(v341))[0]).toMatchObject({
      lifecycle_state: "weaponised",
      alert_state: "open",
      offline: false,
      liveness_last_verdict: "present",
    });
  });

  it("stores no_host, never present, for a weaponised NS-only name — so it is never stranded_live", async () => {
    await seed(v341, [{ id: 1, offlineSince: ago(60) }]);
    const r = await record(v341, [{ id: 1, gone: false, verdict: "no_host", hold: false }]);
    expect(r).toMatchObject({ checked: 1, present: 0, no_host: 1, gone_unconfirmed: 0 });
    // Not gone: the NXDOMAIN clock resets exactly as v329's gone:false did.
    expect((await rows(v341))[0]).toMatchObject({
      lifecycle_state: "weaponised",
      offline: false,
      liveness_last_verdict: "no_host",
    });
    // The reconcile lane's stranded_live predicate (liveness_last_verdict = 'present').
    const n = (
      await v341.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM shopfront_clone_alerts WHERE lifecycle_state='weaponised' AND offline_since IS NULL AND liveness_last_verdict='present'",
      )
    ).rows[0]!.n;
    expect(n).toBe(0);
  });

  it("the TS hold wins over the stored-RDAP regex, which stays the fallback", async () => {
    const stale = ago(13 * 60);
    await seed(v341, [
      { id: 1, offlineSince: stale }, // no stored statuses, TS says hold
      { id: 2, offlineSince: stale, statuses: ["client hold"] }, // TS says no hold
      { id: 3, offlineSince: stale, statuses: ["server hold"] }, // no hold key
    ]);
    await record(v341, [
      { id: 1, gone: true, verdict: "gone", hold: true },
      { id: 2, gone: true, verdict: "gone", hold: false },
      { id: 3, gone: true, verdict: "gone" },
    ]);
    expect((await rows(v341)).map((r) => r.offline_cause)).toEqual([
      "registrar_hold",
      "nxdomain",
      "registrar_hold",
    ]);
  });

  it("an unknown verdict string falls back to the v329 reading of gone, never stores garbage", async () => {
    await seed(v341, [{ id: 1 }]);
    await record(v341, [{ id: 1, gone: false, verdict: "resolves" }]);
    expect((await rows(v341))[0]!.liveness_last_verdict).toBe("present");
  });

  it("list_weaponised_for_liveness returns the stored statuses as an array", async () => {
    await seed(v341, [{ id: 1, statuses: ["server hold"] }, { id: 2 }]);
    const got = (
      await v341.query<{ id: number; whois_statuses: unknown }>(
        "SELECT id, whois_statuses FROM list_weaponised_for_liveness(50, 20, 168) ORDER BY id",
      )
    ).rows.map((r) => [Number(r.id), r.whois_statuses]);
    expect(got).toEqual([
      [1, ["server hold"]],
      [2, []],
    ]);
  });
});

describe("one registry-hold rule: TS isRegistryHold agrees with the v329 regex fallback", () => {
  // The two spellings prod stores (2026-09-28: 51 "server hold", 32 "client
  // hold", 0 disagreements across 3,712 rows) plus the EPP camelCase forms.
  const cases: string[][] = [
    ["server hold"],
    ["client hold"],
    ["clientHold"],
    ["serverHold"],
    ["client_hold"],
    ["client transfer prohibited", "server hold"],
    ["client transfer prohibited"],
    ["active"],
    [],
  ];
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))("%s", async (_n, statuses) => {
    const sql = (
      await v341.query<{ rx: boolean }>(
        `SELECT COALESCE($1::jsonb::text ~* '(client|server)[ _-]?hold', false) AS rx`,
        [JSON.stringify(statuses)],
      )
    ).rows[0]!.rx;
    expect(isRegistryHold(statuses)).toBe(sql);
  });
});
