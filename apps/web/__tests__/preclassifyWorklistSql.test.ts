import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PRECLASSIFY_FANOUT_CAP } from "@askarthur/scam-engine/inngest/preclassify-fanout";

// Runs the REAL v345 pre-classifier worklist SQL (#1300) against PGlite:
// the selector's give-up gate + order, the failure stamp, the coverage row.
//
// Go-red record (2026-10-13; each guard reverted in the migration → the named
// tests failed → restored):
//   - selector: dropped `COALESCE(f.attempts, 0) < 3`
//        → "rotation: a poison alert leaves the head …" FAILED
//   - selector: ORDER BY first_seen_at DESC (v159's order)
//        → "oldest first …" and "rotation …" FAILED
//   - selector: `f.attempts < 3` without COALESCE (NULL comparison hides
//     every never-failed alert)
//        → 5 tests FAILED (oldest first, never-tried, rotation, cap, due_total)
//   - stamp: attempts + 1 unconditionally (no UTC-day guard)
//        → "a same-day repeat does not count twice …" FAILED
//   - stamp: no JOIN to shopfront_clone_alerts (FK error on an unknown id)
//        → "an unknown alert id is skipped …" FAILED
//   - coverage: due_total counted given-up alerts too
//        → "due_total is the demand before the cap …" FAILED
//   - old code (v159 only, v345 not applied) → all 10 FAILED.
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.shopfront_clone_alerts (
      id bigint PRIMARY KEY, source text NOT NULL DEFAULT 'nrd',
      inferred_target_domain text, candidate_domain text, candidate_url text,
      first_seen_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.clone_watch_classifications (alert_id bigint PRIMARY KEY);
  `);
  await db.exec(
    migration("migration-v159-clone-watch-pending-preclassify-selector.sql"),
  );
  await db.exec(
    migration("migration-v345-clone-watch-preclassify-coverage.sql"),
  );
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () =>
  db.exec(`DELETE FROM clone_watch_preclassify_failures; DELETE FROM clone_watch_classifications;
            DELETE FROM shopfront_clone_alerts;`),
);

/** Insert alert `id` first seen `daysAgo` days ago. */
const alert = (id: number, daysAgo: number, extra = "") =>
  db.exec(`INSERT INTO shopfront_clone_alerts (id, inferred_target_domain, candidate_domain, candidate_url, first_seen_at)
           VALUES (${id}, 'nab.com.au', 'nab-${id}.com', 'https://nab-${id}.com/', now() - interval '${daysAgo} days') ${extra}`);

const worklist = async (limit: number) =>
  (
    await db.query<{ id: number }>(
      `SELECT id FROM list_clone_alerts_pending_preclassify($1)`,
      [limit],
    )
  ).rows.map((r) => Number(r.id));

const stamp = (failures: Array<{ alert_id: number; error: string }>) =>
  db.query<{ n: number }>(
    `SELECT record_clone_watch_preclassify_failures($1::jsonb) AS n`,
    [JSON.stringify(failures)],
  );

/** Push every failure stamp back a day, as if the next daily run is starting. */
const nextDay = () =>
  db.exec(`UPDATE clone_watch_preclassify_failures
             SET last_failed_at = last_failed_at - interval '1 day',
                 first_failed_at = first_failed_at - interval '1 day'`);

const coverage = async () => {
  const r = (
    await db.query<Record<string, number>>(
      `SELECT * FROM clone_watch_preclassify_coverage()`,
    )
  ).rows;
  expect(r).toHaveLength(1);
  return Object.fromEntries(
    Object.entries(r[0]!).map(([k, v]) => [k, Number(v)]),
  );
};

describe("list_clone_alerts_pending_preclassify (v345)", () => {
  it("oldest first, so a bound cap starves the newest — not the alerts nearest the 14-day edge", async () => {
    await alert(1, 1);
    await alert(2, 12);
    await alert(3, 5);
    expect(await worklist(2)).toEqual([2, 3]);
  });

  it("never-tried before retried", async () => {
    await alert(1, 10);
    await alert(2, 1);
    await stamp([{ alert_id: 1, error: "jev 529" }]);
    expect(await worklist(1)).toEqual([2]);
    expect(await worklist(5)).toEqual([2, 1]);
  });

  it("rotation: a poison alert leaves the head after 3 failed days and the next alert gets the slot", async () => {
    await alert(1, 10); // poison: oldest, fails every day
    await alert(2, 9);
    const served: number[][] = [];
    for (let day = 0; day < 5; day++) {
      const ids = await worklist(1);
      served.push(ids);
      if (ids[0] === 1)
        await stamp([{ alert_id: 1, error: "shape: missing answer" }]);
      else if (ids[0] !== undefined) {
        await db.exec(
          `INSERT INTO clone_watch_classifications VALUES (${ids[0]})`,
        );
      }
      await nextDay();
    }
    // Day 0: neither has failed, oldest-first serves 1. Day 1: 2 (never
    // tried) outranks 1 (failed once). Then 1 retries until it is given up
    // after its third failed day, and the worklist is empty — not forever 1.
    expect(served).toEqual([[1], [2], [1], [1], []]);
    const f = (
      await db.query<{ attempts: number }>(
        `SELECT attempts FROM clone_watch_preclassify_failures WHERE alert_id = 1`,
      )
    ).rows[0];
    expect(f?.attempts).toBe(3);
  });

  it("keeps the 14-day horizon and the hard cap of 100", async () => {
    await alert(1, 15);
    await alert(2, 13);
    expect(await worklist(5)).toEqual([2]);
    await db.exec(`INSERT INTO shopfront_clone_alerts (id, inferred_target_domain, candidate_domain, candidate_url)
                   SELECT g, 'nab.com.au', 'x' || g, 'https://x' || g FROM generate_series(100, 260) g`);
    expect(await worklist(500)).toHaveLength(100);
  });

  it("the fan-out cap fits under the RPC's hard ceiling (constants that live in two files)", () => {
    const sql = migration(
      "migration-v345-clone-watch-preclassify-coverage.sql",
    );
    const ceiling = Number(/LEAST\(p_limit,\s*(\d+)\)/.exec(sql)?.[1]);
    expect(ceiling).toBeGreaterThan(0);
    expect(PRECLASSIFY_FANOUT_CAP).toBeLessThanOrEqual(ceiling);
    // Sized to measured demand: max day 70 (2026-07-23), p95 47.8.
    expect(PRECLASSIFY_FANOUT_CAP).toBeGreaterThanOrEqual(70);
  });
});

describe("record_clone_watch_preclassify_failures (v345)", () => {
  it("a same-day repeat does not count twice; the next UTC day does", async () => {
    await alert(1, 1);
    await stamp([{ alert_id: 1, error: "first" }]);
    await stamp([{ alert_id: 1, error: "replay" }]);
    let f = (
      await db.query<{ attempts: number; last_error: string }>(
        `SELECT attempts, last_error FROM clone_watch_preclassify_failures`,
      )
    ).rows;
    expect(f).toEqual([{ attempts: 1, last_error: "replay" }]);
    await nextDay();
    await stamp([{ alert_id: 1, error: "day two" }]);
    f = (
      await db.query<{ attempts: number; last_error: string }>(
        `SELECT attempts, last_error FROM clone_watch_preclassify_failures`,
      )
    ).rows;
    expect(f).toEqual([{ attempts: 2, last_error: "day two" }]);
  });

  it("an unknown alert id is skipped, the rest are stamped", async () => {
    await alert(1, 1);
    const r = await stamp([
      { alert_id: 999, error: "gone" },
      { alert_id: 1, error: "x" },
    ]);
    expect(Number(r.rows[0]?.n)).toBe(1);
  });

  it("anon/authenticated cannot execute the new functions", async () => {
    for (const fn of [
      "record_clone_watch_preclassify_failures(jsonb)",
      "clone_watch_preclassify_coverage()",
      "list_clone_alerts_pending_preclassify(int)",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await db.query<{ ok: boolean }>(
          `SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') AS ok`,
        );
        expect(r.rows[0]?.ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});

describe("clone_watch_preclassify_coverage (v345)", () => {
  it("one row of zeros when nothing is due", async () => {
    expect(await coverage()).toEqual({
      due_total: 0,
      gave_up_total: 0,
      gave_up_24h: 0,
      aged_out_total: 0,
    });
  });

  it("due_total is the demand before the cap; given-up and aged-out are separate", async () => {
    await db.exec(`INSERT INTO shopfront_clone_alerts (id, inferred_target_domain, candidate_domain, candidate_url)
                   SELECT g, 'nab.com.au', 'x' || g, 'https://x' || g FROM generate_series(1, 130) g`);
    await alert(500, 20); // aged out, never classified
    await alert(501, 3);
    await db.exec(
      `INSERT INTO clone_watch_preclassify_failures (alert_id, attempts) VALUES (501, 3)`,
    );
    await alert(502, 2, ""); // classified — not demand
    await db.exec(`INSERT INTO clone_watch_classifications VALUES (502)`);
    await db.exec(
      `INSERT INTO shopfront_clone_alerts (id, source, inferred_target_domain) VALUES (503, 'manual', 'nab.com.au')`,
    );
    expect(await coverage()).toEqual({
      due_total: 130,
      gave_up_total: 1,
      gave_up_24h: 1,
      aged_out_total: 1,
    });
    expect(await worklist(500)).toHaveLength(100);
  });
});
