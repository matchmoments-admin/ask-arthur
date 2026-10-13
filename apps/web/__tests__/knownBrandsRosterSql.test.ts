import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: { createFunction: vi.fn(() => ({})), send: vi.fn() },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_: unknown, fn: unknown) => fn,
}));
vi.mock("@askarthur/scam-engine/active-watchlist", () => ({
  getActiveWatchlistDetailed: vi.fn(),
}));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({ sendAdminTelegramMessage: vi.fn() }));
vi.mock("@/app/api/inngest/functions/report-brand-stewardship", () => ({
  deriveBrandKey: (b: string) => b.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase(),
}));

import { buildBrandResolver, type BrandEntry } from "@askarthur/shopfront-glue";
import {
  selectDiscoverCandidates,
  type KnownBrandCoverageRow,
} from "@/app/api/inngest/functions/known-brands-discover";
import { canonicalBrandKeyResolver } from "@/lib/clone-watch/canonical-brand-key";

// Runs the REAL v348 SQL (#1304: one watched-brand roster) on top of v174
// (brand_normalize / resolve_brand), v207 + v256 + v347 (the Brand Subscriber)
// and a known_brands table in its prod shape (2026-10-13).
//
// The rotation case is the worklist-gate starvation rule's go-red test: the
// discover worklist (selectDiscoverCandidates, TS) and its stamp
// (record_known_brand_probe, SQL) are run against each other for several runs.
//
// Go-reds (2026-10-13), each against an edited v348 or selector, then reverted:
//   - record_known_brand_probe's seeded-row branch without `probed_at = v_now`
//     failed the rotation case (the seeds re-presented at the head of every
//     run) and "fills an unprobed seeded row";
//   - the selector with no unprobed-seed test (every 'none' row covering — the
//     pre-v348 coverage) failed the rotation case (seeds never selected);
//   - seed_known_brand_for_subscriber without the twin-category guard (NOT
//     EXISTS … brand_category IS NOT NULL) failed "leaves a domain that already
//     has a category alone", "matches on the Canonical Brand" and "never
//     overwrites a curated category";
//   - dropping the backfill UPDATE failed "the backfill keeps today's
//     coverage" and the rotation case (the probed miss came back as a
//     candidate — a 236-brand re-probe in prod).
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

const ORG = "11111111-1111-4111-8111-111111111111";
const HOUSE = "00000000-0000-4000-8000-000000000001";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE TABLE org_members (org_id uuid, user_id uuid, status text);
    CREATE TABLE shopfront_clone_alerts (
      id bigint PRIMARY KEY, candidate_domain text, candidate_url text,
      source text DEFAULT 'nrd', lifecycle_state text DEFAULT 'monitoring',
      target_brand_normalized text, inferred_target_domain text,
      urlscan_uuid text, urlscan_evidence jsonb, urlscan_failure_streak integer DEFAULT 0,
      last_rechecked_at timestamptz, first_seen_at timestamptz DEFAULT now(),
      recheck_dns_fingerprint text
    );
    -- known_brands as prod has it (information_schema, 2026-10-13).
    CREATE TABLE public.known_brands (
      id serial PRIMARY KEY,
      brand_name text NOT NULL,
      brand_domain text,
      brand_category text,
      security_contact_email text,
      security_contact_url text,
      contact_type text NOT NULL DEFAULT 'email',
      evidence_format text,
      last_verified_at timestamptz DEFAULT now(),
      verified_by text,
      is_active boolean NOT NULL DEFAULT true,
      notes text,
      source_url text,
      brand_key text,
      CONSTRAINT known_brands_brand_name_key UNIQUE (brand_name),
      CONSTRAINT known_brands_contact_type_ck
        CHECK (contact_type = ANY (ARRAY['email','webform','inproduct','none']))
    );
    CREATE UNIQUE INDEX known_brands_brand_key_active_idx
      ON public.known_brands (brand_key) WHERE is_active = true;
    -- Pre-v348 rows, one of each provenance measured in prod.
    INSERT INTO known_brands (brand_name, brand_domain, contact_type, security_contact_email,
                              is_active, last_verified_at, verified_by, notes, brand_key)
    VALUES
      ('Probed Miss', 'probedmiss.com.au', 'none', NULL, false, NULL, NULL,
       'Probed — no security.txt contact found.', 'probed_miss'),
      ('Discovered', 'discovered.com.au', 'email', 'sec@discovered.com.au', true, '2026-07-01',
       'security_txt_discovery', 'Auto-discovered from RFC 9116 security.txt.', 'discovered'),
      ('Curated', 'curated.com.au', 'email', 'sec@curated.com.au', true, '2026-06-15',
       'research-2026-06-15', NULL, 'curated');
  `);
  // v174's schema half only (brand_normalize, brand_aliases, resolve_brand) —
  // its seed half reads brand_contact_directory, which this harness lacks.
  const v174 = migration("migration-v174-canonical-brand-alias-layer.sql");
  await db.exec(v174.slice(0, v174.indexOf("-- 4a. Seed")));
  await db.exec(migration("migration-v207-monitored-brands.sql"));
  await db.exec(migration("migration-v256-monitored-brands-overlay-guards.sql"));
  await db.exec(migration("migration-v347-brand-subscriber.sql"));
  await db.exec(migration("migration-v348-known-brands-one-roster.sql"));
  // Idempotent: a second apply must not fail.
  await db.exec(migration("migration-v348-known-brands-one-roster.sql"));
});
afterAll(async () => {
  await db.close();
});

describe("v348 backfill", () => {
  it("the backfill keeps today's coverage: probed rows stamped, curated rows untouched", async () => {
    const r = await db.query<{ brand_name: string; probed: boolean }>(
      `SELECT brand_name, probed_at IS NOT NULL AS probed FROM known_brands
       WHERE brand_name IN ('Probed Miss','Discovered','Curated') ORDER BY brand_name`,
    );
    expect(r.rows).toEqual([
      { brand_name: "Curated", probed: false },
      { brand_name: "Discovered", probed: true },
      { brand_name: "Probed Miss", probed: true },
    ]);
  });
});

async function resetBrands() {
  await db.exec(`
    TRUNCATE monitored_brands RESTART IDENTITY;
    DELETE FROM known_brands WHERE brand_name NOT IN ('Probed Miss','Discovered','Curated');
    DELETE FROM brand_aliases;
  `);
}

async function subscriber(
  opts: {
    org?: string;
    name?: string;
    normalized?: string;
    domains?: string[];
    status?: string | null;
  } = {},
): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO monitored_brands (org_id, brand_name, brand_normalized, legitimate_domains,
       plan, subscription_status, billing_provider)
     VALUES ($1, $2, $3, $4, 'brand_pilot', $5, 'manual') RETURNING id`,
    [
      opts.org ?? ORG,
      opts.name ?? "Acme Bank",
      opts.normalized ?? "acmebank",
      opts.domains ?? ["acmebank.com.au"],
      opts.status === undefined ? "active" : opts.status,
    ],
  );
  return r.rows[0].id;
}

async function seed(subId: number, category: string | null = "bank") {
  const r = await db.query<{ known_brand_id: number | null; outcome: string }>(
    `SELECT * FROM seed_known_brand_for_subscriber($1, 'acme_bank', $2)`,
    [subId, category],
  );
  return r.rows[0];
}

async function kbRow(id: number) {
  const r = await db.query<Record<string, unknown>>(`SELECT * FROM known_brands WHERE id = $1`, [id]);
  return r.rows[0];
}

describe("seed_known_brand_for_subscriber", () => {
  beforeEach(resetBrands);

  it("creates an inactive, contact-less, unprobed row with the operator's category", async () => {
    const out = await seed(await subscriber());
    expect(out.outcome).toBe("created");
    const row = await kbRow(out.known_brand_id!);
    expect(row).toMatchObject({
      brand_name: "Acme Bank",
      brand_domain: "acmebank.com.au",
      brand_key: "acme_bank",
      brand_category: "bank",
      contact_type: "none",
      security_contact_email: null,
      security_contact_url: null,
      is_active: false,
      probed_at: null,
    });
  });

  it("never copies the subscriber's alert contact into known_brands", async () => {
    const id = await subscriber();
    await db.query(`UPDATE monitored_brands SET alert_contact_email = 'buyer@acmebank.com.au' WHERE id = $1`, [id]);
    const out = await seed(id);
    const row = await kbRow(out.known_brand_id!);
    expect(row.security_contact_email).toBeNull();
  });

  it("writes nothing for a pending, canceled or house-org row", async () => {
    for (const status of ["pending", "canceled"]) {
      await resetBrands();
      expect((await seed(await subscriber({ status }))).outcome).toBe("not_subscriber");
    }
    await resetBrands();
    expect((await seed(await subscriber({ org: HOUSE, status: null }))).outcome).toBe(
      "not_subscriber",
    );
    const n = await db.query<{ n: number }>(`SELECT count(*)::int n FROM known_brands`);
    expect(n.rows[0].n).toBe(3);
  });

  it("an active row with no legitimate domain is 'no_domain'", async () => {
    expect((await seed(await subscriber({ domains: [] }))).outcome).toBe("no_domain");
  });

  it("matches an existing row by domain and fills only a category gap", async () => {
    await db.exec(`INSERT INTO known_brands (brand_name, brand_domain, contact_type, brand_key)
                   VALUES ('ACME', 'acmebank.com.au', 'email', 'acme')`);
    const out = await seed(await subscriber());
    expect(out.outcome).toBe("existing_category_set");
    expect((await kbRow(out.known_brand_id!)).brand_category).toBe("bank");
    const n = await db.query<{ n: number }>(`SELECT count(*)::int n FROM known_brands`);
    expect(n.rows[0].n).toBe(4); // no second row
  });

  it("leaves a domain that already has a category alone (#1305's lowest-id non-null rule)", async () => {
    // The commbank shape: a NULL-category twin with the LOWER id, and a
    // categorised row. The domain's answer is 'finance'; the seed must not
    // give it a second, different one.
    await db.exec(`
      INSERT INTO known_brands (brand_name, brand_domain, contact_type, brand_key)
      VALUES ('Acme Bank Twin', 'acmebank.com.au', 'none', 'acme_twin');
      INSERT INTO known_brands (brand_name, brand_domain, contact_type, brand_category, brand_key)
      VALUES ('Acme Group', 'acmebank.com.au', 'email', 'finance', 'acme_group');
    `);
    const out = await seed(await subscriber(), "bank");
    expect(out.outcome).toBe("existing");
    const cats = await db.query<{ brand_category: string | null }>(
      `SELECT brand_category FROM known_brands WHERE brand_domain = 'acmebank.com.au' ORDER BY id`,
    );
    expect(cats.rows.map((r) => r.brand_category)).toEqual([null, "finance"]);
  });

  it("matches on the Canonical Brand when the domain differs", async () => {
    await db.exec(`
      INSERT INTO brand_aliases (alias_normalized, canonical_brand) VALUES
        ('acme', 'Acme Bank'), ('acmebank', 'Acme Bank');
      INSERT INTO known_brands (brand_name, brand_domain, contact_type, brand_category, brand_key)
      VALUES ('ACME', 'acme.com', 'email', 'bank', 'acme');
    `);
    const out = await seed(await subscriber());
    expect(out.outcome).toBe("existing");
  });

  it("never overwrites a curated category", async () => {
    await db.exec(`INSERT INTO known_brands (brand_name, brand_domain, contact_type, brand_category, brand_key)
                   VALUES ('ACME', 'acmebank.com.au', 'email', 'tech', 'acme')`);
    const out = await seed(await subscriber(), "bank");
    expect(out.outcome).toBe("existing");
    expect((await kbRow(out.known_brand_id!)).brand_category).toBe("tech");
  });
});

async function probe(name: string, domain: string, email: string | null = null, url: string | null = null) {
  const r = await db.query<{ known_brand_id: number; outcome: string }>(
    `SELECT * FROM record_known_brand_probe($1, $2, $3, $4, $5)`,
    [name, domain, name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase(), email, url],
  );
  return r.rows[0];
}

describe("record_known_brand_probe", () => {
  beforeEach(resetBrands);

  it("inserts a probed miss and a probed hit for a brand with no row", async () => {
    const miss = await probe("Newco", "newco.com.au");
    expect(miss.outcome).toBe("inserted_none");
    expect(await kbRow(miss.known_brand_id)).toMatchObject({ contact_type: "none", is_active: false });
    expect((await kbRow(miss.known_brand_id)).probed_at).not.toBeNull();

    const hit = await probe("Hitco", "hitco.com.au", "Security@Hitco.com.au");
    expect(hit.outcome).toBe("inserted_contact");
    expect(await kbRow(hit.known_brand_id)).toMatchObject({
      contact_type: "email",
      security_contact_email: "security@hitco.com.au",
      is_active: true,
      verified_by: "security_txt_discovery",
    });
  });

  it("fills an unprobed seeded row, keeping its category", async () => {
    const seeded = await seed(await subscriber());
    const out = await probe("Acme Bank", "acmebank.com.au", "sec@acmebank.com.au");
    expect(out).toEqual({ known_brand_id: seeded.known_brand_id, outcome: "seed_probed_contact" });
    const row = await kbRow(seeded.known_brand_id!);
    expect(row).toMatchObject({
      contact_type: "email",
      security_contact_email: "sec@acmebank.com.au",
      is_active: true,
      brand_category: "bank",
    });
    expect(row.probed_at).not.toBeNull();
  });

  it("never overwrites a curated contact — it only stamps probed_at", async () => {
    const out = await probe("Curated", "curated.com.au", "attacker@evil.example");
    expect(out.outcome).toBe("existing_untouched");
    const r = await db.query<{ security_contact_email: string; probed: boolean }>(
      `SELECT security_contact_email, probed_at IS NOT NULL probed FROM known_brands WHERE brand_name = 'Curated'`,
    );
    expect(r.rows[0]).toEqual({ security_contact_email: "sec@curated.com.au", probed: true });
    await db.exec(`UPDATE known_brands SET probed_at = NULL WHERE brand_name = 'Curated'`);
  });

  it("keeps a found contact inactive when another active row holds the brand_key", async () => {
    await db.exec(`INSERT INTO known_brands (brand_name, brand_domain, contact_type, brand_key, is_active)
                   VALUES ('Dupe Co Pty', 'dupe.com', 'email', 'dupe_co', true)`);
    const out = await probe("Dupe Co", "dupe.co", "sec@dupe.co");
    expect(out.outcome).toBe("contact_key_conflict");
    expect((await kbRow(out.known_brand_id)).is_active).toBe(false);
  });
});

describe("the discover worklist rotates (worklist-gate starvation rule)", () => {
  beforeEach(resetBrands);

  async function coverageRows(): Promise<KnownBrandCoverageRow[]> {
    const r = await db.query<KnownBrandCoverageRow>(
      `SELECT id, brand_name, brand_domain, contact_type, probed_at::text AS probed_at FROM known_brands`,
    );
    return r.rows;
  }

  it("every candidate is probed exactly once across runs; seeds first; then the worklist is empty", async () => {
    // 2 activated subscribers (seeded rows) + 20 roster brands with no row.
    const a = await subscriber({ name: "Alpha Bank", normalized: "alphabank", domains: ["alphabank.com.au"] });
    const b = await subscriber({ name: "Beta Super", normalized: "betasuper", domains: ["betasuper.com.au"] });
    expect((await db.query(`SELECT * FROM seed_known_brand_for_subscriber($1, 'alpha_bank', 'bank')`, [a])).rows).toHaveLength(1);
    expect((await db.query(`SELECT * FROM seed_known_brand_for_subscriber($1, 'beta_super', 'super')`, [b])).rows).toHaveLength(1);

    const roster: BrandEntry[] = [
      // already covered (probed miss / curated contact) — never a candidate
      { brand: "Probed Miss", legitimate_domains: ["probedmiss.com.au"] },
      { brand: "Curated", legitimate_domains: ["curated.com.au"] },
      ...Array.from({ length: 20 }, (_, i) => ({
        brand: `Roster Brand ${i}`,
        legitimate_domains: [`rosterbrand${i}.com.au`],
      })),
    ];
    const canonicalKey = canonicalBrandKeyResolver(buildBrandResolver({}));

    const seen: string[] = [];
    const runs: string[][] = [];
    for (let run = 0; run < 4; run++) {
      const picked = selectDiscoverCandidates(roster, await coverageRows(), canonicalKey, 15);
      runs.push(picked.map((c) => c.brand));
      for (const c of picked) {
        await probe(c.brand, c.domain); // every probe misses — the worst case
        seen.push(c.brand);
      }
    }

    expect(runs[0].slice(0, 2)).toEqual(["Alpha Bank", "Beta Super"]);
    expect(runs[0]).toHaveLength(15);
    expect(runs[1]).toHaveLength(7);
    expect(runs[2]).toEqual([]);
    expect(runs[3]).toEqual([]);
    expect(new Set(seen).size).toBe(seen.length); // nobody probed twice
    expect(seen).toHaveLength(22);
    expect(seen).not.toContain("Probed Miss");
    expect(seen).not.toContain("Curated");
  });
});
