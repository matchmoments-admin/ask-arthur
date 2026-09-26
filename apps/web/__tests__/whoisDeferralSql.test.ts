import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Runs the REAL v336 SQL (#1253) in PGlite: v331 is loaded first (the body
 * v336 replaces), then v336, so every case runs against what prod will run.
 * Replaces the text-grep checks the first review called out.
 *
 * Go-red record (2026-09-27, each edit applied to the loaded v336 text →
 * failed → restored):
 *   - merge replaced by `SET attribution = src.whois` → "merges only the
 *     whois key" fails (kit_siblings lost).
 *   - `AND a.attribution_retry_after <= pg_catalog.now()` removed → "a
 *     stale write cannot clobber a row pushed forward" fails.
 *   - `attribution_retry_after = src.retry_after` removed from
 *     apply_clone_alert_attributions → "the first write stamps the column"
 *     fails.
 *   - the backfill's `registrar IS NULL` arm removed → "backfill marks only
 *     in-window whoisjson rows with no registrar" fails.
 */

const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

const NEXT_MONTH_UTC = (() => {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  ).getTime();
})();

let db: PGlite;

async function insert(
  id: number,
  attribution: unknown,
  opts: { ageDays?: number; retryAfterSql?: string } = {},
) {
  await db.query(
    `INSERT INTO shopfront_clone_alerts (id, candidate_domain, attribution, first_seen_at)
     VALUES ($1, $2, $3::jsonb, now() - make_interval(days => $4::int))`,
    [
      id,
      `d${id}.example`,
      attribution === null ? null : JSON.stringify(attribution),
      opts.ageDays ?? 1,
    ],
  );
  if (opts.retryAfterSql) {
    await db.exec(
      `UPDATE shopfront_clone_alerts SET attribution_retry_after = ${opts.retryAfterSql} WHERE id = ${id}`,
    );
  }
}
const row = async (id: number) =>
  (
    await db.query<{
      attribution: Record<string, unknown> | null;
      retry: string | null;
      campaign_key: string | null;
    }>(
      `SELECT attribution, attribution_retry_after::text AS retry, campaign_key
         FROM shopfront_clone_alerts WHERE id = $1`,
      [id],
    )
  ).rows[0]!;
const reoffer = async (rows: unknown[]) =>
  Number(
    (
      await db.query<{ n: number }>(
        "SELECT apply_clone_alert_whois_reoffers($1::jsonb) AS n",
        [JSON.stringify(rows)],
      )
    ).rows[0]!.n,
  );

describe("v336 whois deferral SQL", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE shopfront_clone_alerts (
        id bigint PRIMARY KEY, candidate_domain text, attribution jsonb,
        campaign_key text, first_seen_at timestamptz DEFAULT now(),
        recheck_count integer DEFAULT 0, last_rechecked_at timestamptz,
        updated_at timestamptz
      );
    `);
    await db.exec(migration("migration-v331-clone-watch-batch-writes.sql"));
    // Rows that exist BEFORE v336, so its backfill runs against them.
    await db.exec(`
      INSERT INTO shopfront_clone_alerts (id, attribution, first_seen_at) VALUES
        (901, '{"whois":{"source":"whoisjson","registrar":null},"kit_siblings":{"n":1}}', now() - interval '3 days'),
        (902, '{"whois":{"source":"whoisjson","registrar":"GoDaddy"}}', now() - interval '3 days'),
        (903, '{"whois":{"source":"whoisjson","registrar":null}}', now() - interval '60 days'),
        (904, '{"whois":{"source":"rdap","registrar":null}}', now() - interval '3 days'),
        (905, '{"whois":{"source":"deferred","registrar":null}}', now() - interval '3 days'),
        (906, NULL, now() - interval '3 days');
    `);
    await db.exec(
      migration("migration-v336-clone-attribution-whois-deferral.sql"),
    );
  }, 30_000);
  afterAll(async () => db?.close());

  it("backfill marks only in-window whoisjson rows with no registrar (and stray deferred ones) for the 1st of next month", async () => {
    const marked = (
      await db.query<{ id: number; retry: string }>(
        `SELECT id, attribution_retry_after AS retry FROM shopfront_clone_alerts
          WHERE attribution_retry_after IS NOT NULL ORDER BY id`,
      )
    ).rows;
    expect(marked.map((r) => Number(r.id))).toEqual([901, 905]);
    for (const r of marked) {
      expect(new Date(r.retry).getTime()).toBe(NEXT_MONTH_UTC);
    }
  });

  describe("apply_clone_alert_whois_reoffers", () => {
    beforeEach(async () =>
      db.exec("DELETE FROM shopfront_clone_alerts WHERE id < 900"),
    );

    it("merges only the whois key and clears the mark", async () => {
      await insert(
        1,
        {
          whois: { source: "whoisjson" },
          kit_siblings: { n: 2 },
          ct: { issuer: "LE" },
        },
        {
          retryAfterSql: "now() - interval '1 hour'",
        },
      );
      expect(
        await reoffer([
          {
            id: 1,
            whois: { source: "rdap", registrar: "R" },
            retry_after: null,
          },
        ]),
      ).toBe(1);
      const r = await row(1);
      expect(r.attribution).toEqual({
        whois: { source: "rdap", registrar: "R" },
        kit_siblings: { n: 2 },
        ct: { issuer: "LE" },
      });
      expect(r.retry).toBeNull();
    });

    it("pushes the mark forward on a re-deferral, and replaces campaign_key only when given", async () => {
      await insert(
        2,
        { whois: { source: "whoisjson" } },
        { retryAfterSql: "now() - interval '1 hour'" },
      );
      await db.exec(
        "UPDATE shopfront_clone_alerts SET campaign_key = 'old' WHERE id = 2",
      );
      await reoffer([
        {
          id: 2,
          whois: { source: "deferred" },
          retry_after: "2099-01-01T00:00:00Z",
          campaign_key: null,
        },
      ]);
      const r = await row(2);
      expect(new Date(r.retry!).getUTCFullYear()).toBe(2099);
      expect(r.campaign_key).toBe("old");
    });

    it("a stale write cannot clobber a row pushed forward (retry_after in the future)", async () => {
      await insert(
        3,
        { whois: { source: "deferred", n: "newer" } },
        { retryAfterSql: "now() + interval '10 days'" },
      );
      expect(
        await reoffer([
          { id: 3, whois: { source: "rdap", n: "older" }, retry_after: null },
        ]),
      ).toBe(0);
      expect((await row(3)).attribution).toEqual({
        whois: { source: "deferred", n: "newer" },
      });
    });

    it("writes nothing to an unmarked row or one without a dossier", async () => {
      await insert(4, { whois: { source: "rdap" } });
      await insert(5, null, { retryAfterSql: "now() - interval '1 hour'" });
      expect(
        await reoffer([
          { id: 4, whois: { source: "x" }, retry_after: null },
          { id: 5, whois: { source: "x" }, retry_after: null },
        ]),
      ).toBe(0);
      expect((await row(5)).attribution).toBeNull();
    });

    it("carries a function-level statement_timeout (not a decorative in-body SET LOCAL)", async () => {
      const cfg = (
        await db.query<{ proname: string; proconfig: string[] | null }>(
          `SELECT proname, proconfig FROM pg_proc
            WHERE proname IN ('apply_clone_alert_whois_reoffers', 'apply_clone_alert_attributions')`,
        )
      ).rows;
      expect(cfg).toHaveLength(2);
      for (const c of cfg)
        expect(c.proconfig).toContain("statement_timeout=30s");
    });
  });

  describe("apply_clone_alert_attributions (v336 body)", () => {
    beforeEach(async () =>
      db.exec("DELETE FROM shopfront_clone_alerts WHERE id < 900"),
    );

    it("the first write stamps the column, and only where attribution IS NULL", async () => {
      await insert(10, null);
      await insert(11, { whois: { source: "rdap" } });
      const n = (
        await db.query<{ n: number }>(
          "SELECT apply_clone_alert_attributions($1::jsonb) AS n",
          [
            JSON.stringify([
              {
                id: 10,
                attribution: { whois: { source: "deferred" } },
                attribution_retry_after: "2099-01-01T00:00:00Z",
              },
              {
                id: 11,
                attribution: { whois: { source: "deferred" } },
                attribution_retry_after: "2099-01-01T00:00:00Z",
              },
            ]),
          ],
        )
      ).rows[0]!.n;
      expect(Number(n)).toBe(1);
      expect(new Date((await row(10)).retry!).getUTCFullYear()).toBe(2099);
      expect((await row(11)).retry).toBeNull();
    });

    it("an element without the key leaves the column NULL (v331 callers unchanged)", async () => {
      await insert(12, null);
      await db.query("SELECT apply_clone_alert_attributions($1::jsonb)", [
        JSON.stringify([
          {
            id: 12,
            attribution: { whois: { source: "rdap" } },
            campaign_key: null,
          },
        ]),
      ]);
      expect((await row(12)).retry).toBeNull();
    });
  });
});
