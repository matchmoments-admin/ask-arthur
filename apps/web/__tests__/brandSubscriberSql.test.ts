import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BRAND_SUBSCRIBER_STATUSES,
  entitlementsFor,
} from "@/lib/clone-watch/brand-subscriber";

// Runs the REAL v347 SQL (Brand Subscriber, #1295) on top of v207 + v256.
//
// The priority-rescan worklist repeats one rule the TS entitlement Module owns
// (entitlementsFor().priorityRescan); the drift case below enumerates every
// status x verification x plan x is_active combination and requires the SQL
// and the TS to agree on each.
//
// Go-reds (2026-10-13), each against an edited v347, then reverted:
//   - priority predicate without `verification_status = 'verified'` failed the
//     drift case (an unverified paid row got rescans the TS says it may not);
//   - `sca.last_rechecked_at < now() - …` without COALESCE failed "a
//     never-rechecked lookalike is due" (the NULL-comparison trap);
//   - apply_brand_subscription with `WHEN 'past_due' THEN 'lapsed'`
//     unconditionally failed "a failed first payment leaves the row pending";
//   - the hijack guard removed failed "never re-points a row bound to another
//     live subscription".
const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), "utf8");

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const HOUSE = "00000000-0000-4000-8000-000000000001";
const USER = "33333333-3333-4333-8333-333333333333";

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
  `);
  await db.exec(migration("migration-v207-monitored-brands.sql"));
  await db.exec(
    migration("migration-v256-monitored-brands-overlay-guards.sql"),
  );
  await db.exec(migration("migration-v347-brand-subscriber.sql"));
  // Idempotent: a second apply must not fail.
  await db.exec(migration("migration-v347-brand-subscriber.sql"));
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(`
    TRUNCATE monitored_brands RESTART IDENTITY;
    TRUNCATE brand_unmatched_payments RESTART IDENTITY;
    TRUNCATE shopfront_clone_alerts;
  `);
});

async function pending(org = ORG, brand = "acme", domain = "acme.com.au") {
  const r = await db.query<{ brand_subscriber_id: number; outcome: string }>(
    `SELECT * FROM upsert_pending_brand_subscriber($1, $2, $3, $4, 'brand_pilot', 'Sec@Acme.com.au', $5)`,
    [org, brand.toUpperCase(), brand, domain, USER],
  );
  return r.rows[0];
}
async function apply(
  subId: number | null,
  stripeSub: string,
  status: string,
  org = ORG,
  plan = "brand_monitor",
) {
  const r = await db.query<{ n: number }>(
    `SELECT apply_brand_subscription($1, $2, $3, $4, $5) AS n`,
    [org, subId, stripeSub, plan, status],
  );
  return r.rows[0].n;
}
async function row(id: number) {
  const r = await db.query<Record<string, unknown>>(
    `SELECT * FROM monitored_brands WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

describe("upsert_pending_brand_subscriber (checkout)", () => {
  it("creates a pending, unverified row with the primary domain and a lower-cased contact", async () => {
    const p = await pending();
    expect(p.outcome).toBe("created");
    const r = await row(p.brand_subscriber_id);
    expect(r).toMatchObject({
      subscription_status: "pending",
      verification_status: "pending",
      legitimate_domains: ["acme.com.au"],
      alert_contact_email: "sec@acme.com.au",
      plan: "brand_pilot",
      billing_provider: "stripe",
    });
  });

  it("reopens an abandoned pending row instead of erroring on the UNIQUE", async () => {
    const a = await pending();
    const b = await pending();
    expect(b).toEqual({
      brand_subscriber_id: a.brand_subscriber_id,
      outcome: "reopened",
    });
  });

  it("refuses a second subscription for an already-active brand", async () => {
    const p = await pending();
    await apply(p.brand_subscriber_id, "sub_1", "active");
    expect((await pending()).outcome).toBe("already_subscribed");
  });

  it("never rewrites a verified row's legitimate domains from a checkout form", async () => {
    const p = await pending();
    await db.query(
      `UPDATE monitored_brands SET verification_status = 'verified' WHERE id = $1`,
      [p.brand_subscriber_id],
    );
    await pending(ORG, "acme", "attacker.example");
    expect((await row(p.brand_subscriber_id)).legitimate_domains).toEqual([
      "acme.com.au",
    ]);
  });

  it("refuses the house org", async () => {
    await expect(pending(HOUSE)).rejects.toThrow(/house org/);
  });
});

describe("apply_brand_subscription (webhook)", () => {
  it("activates the checkout's pending row and binds the Stripe subscription", async () => {
    const p = await pending();
    expect(await apply(p.brand_subscriber_id, "sub_1", "active")).toBe(1);
    const r = await row(p.brand_subscriber_id);
    expect(r).toMatchObject({
      subscription_status: "active",
      plan: "brand_monitor",
      stripe_subscription_id: "sub_1",
    });
    expect(r.activated_at).not.toBeNull();
  });

  it("matches nothing for another org's metadata (0 = unmatched payment)", async () => {
    const p = await pending();
    expect(
      await apply(p.brand_subscriber_id, "sub_1", "active", OTHER_ORG),
    ).toBe(0);
    expect((await row(p.brand_subscriber_id)).subscription_status).toBe(
      "pending",
    );
  });

  it("a failed first payment leaves the row pending (no entitlement before money)", async () => {
    const p = await pending();
    expect(await apply(p.brand_subscriber_id, "sub_1", "past_due")).toBe(1);
    const r = await row(p.brand_subscriber_id);
    expect(r.subscription_status).toBe("pending");
    expect(r.plan).toBe("brand_pilot");
  });

  it("active → past_due is lapsed (dunning grace), → active again restores", async () => {
    const p = await pending();
    await apply(p.brand_subscriber_id, "sub_1", "active");
    await apply(null, "sub_1", "past_due");
    expect((await row(p.brand_subscriber_id)).subscription_status).toBe(
      "lapsed",
    );
    await apply(null, "sub_1", "active");
    expect((await row(p.brand_subscriber_id)).subscription_status).toBe(
      "active",
    );
  });

  it("cancels by the STORED subscription id alone", async () => {
    const p = await pending();
    await apply(p.brand_subscriber_id, "sub_1", "active");
    expect(await apply(null, "sub_other", "canceled")).toBe(0);
    expect(await apply(null, "sub_1", "canceled")).toBe(1);
    const r = await row(p.brand_subscriber_id);
    expect(r.subscription_status).toBe("canceled");
    expect(r.canceled_at).not.toBeNull();
  });

  it("never re-points a row bound to another live subscription", async () => {
    const p = await pending();
    await apply(p.brand_subscriber_id, "sub_1", "active");
    expect(await apply(p.brand_subscriber_id, "sub_2", "active")).toBe(0);
    expect((await row(p.brand_subscriber_id)).stripe_subscription_id).toBe(
      "sub_1",
    );
  });

  it("leaves a manual pilot (no Stripe subscription) untouched by a Stripe cancellation", async () => {
    await db.query(
      `INSERT INTO monitored_brands (org_id, brand_name, brand_normalized, legitimate_domains,
         verification_status, plan, subscription_status, billing_provider)
       VALUES ($1, 'Pilot', 'pilot', ARRAY['pilot.com.au'], 'verified', 'brand_pilot', 'active', 'manual')`,
      [ORG],
    );
    expect(await apply(null, "sub_1", "canceled")).toBe(0);
  });
});

describe("constraints", () => {
  it("the house org never subscribes", async () => {
    await expect(
      db.query(
        `INSERT INTO monitored_brands (org_id, brand_name, brand_normalized, subscription_status, plan)
         VALUES ($1, 'X', 'x', 'active', 'brand_pilot')`,
        [HOUSE],
      ),
    ).rejects.toThrow(/house_not_subscriber/);
  });

  it("an entitled status needs a plan", async () => {
    await expect(
      db.query(
        `INSERT INTO monitored_brands (org_id, brand_name, brand_normalized, subscription_status)
         VALUES ($1, 'X', 'x', 'active')`,
        [ORG],
      ),
    ).rejects.toThrow(/entitled_needs_plan/);
  });
});

describe("record_brand_unmatched_payment", () => {
  it("de-duplicates per (subscription, reason) and reopens a resolved repeat", async () => {
    const rec = () =>
      db.query(
        `SELECT record_brand_unmatched_payment('sub_9', 'cus_9', $1, NULL, 'brand_monitor', 'active', 'no_subscriber_row')`,
        [ORG],
      );
    await rec();
    await db.exec(`UPDATE brand_unmatched_payments SET resolved_at = now()`);
    await rec();
    const r = await db.query<{
      seen_count: number;
      resolved_at: string | null;
    }>(`SELECT seen_count, resolved_at FROM brand_unmatched_payments`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ seen_count: 2, resolved_at: null });
  });
});

describe("list_brand_subscriber_priority_rescans", () => {
  async function subscriber(
    over: Partial<{
      org: string;
      brand: string;
      status: string | null;
      verification: string;
      plan: string | null;
      active: boolean;
      domains: string[];
    }> = {},
  ) {
    const o = {
      org: ORG,
      brand: "acme",
      status: "active" as string | null,
      verification: "verified",
      plan: "brand_pilot" as string | null,
      active: true,
      domains: ["acme.com.au"],
      ...over,
    };
    await db.query(
      `INSERT INTO monitored_brands (org_id, brand_name, brand_normalized, legitimate_domains,
         verification_status, plan, subscription_status, is_active)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7)`,
      [o.org, o.brand, o.domains, o.verification, o.plan, o.status, o.active],
    );
  }
  async function alert(
    id: number,
    over: Partial<{
      brand: string | null;
      domain: string | null;
      state: string;
      rechecked: string | null;
      dead: boolean;
    }> = {},
  ) {
    const o = {
      brand: "acme" as string | null,
      domain: null as string | null,
      state: "monitoring",
      rechecked: "now() - interval '25 hours'" as string | null,
      dead: false,
      ...over,
    };
    await db.query(
      `INSERT INTO shopfront_clone_alerts (id, candidate_domain, candidate_url, lifecycle_state,
         target_brand_normalized, inferred_target_domain, last_rechecked_at,
         urlscan_failure_streak, urlscan_evidence)
       VALUES ($1, $2, $3, $4, $5, $6, ${o.rechecked ?? "NULL"}, $7, $8)`,
      [
        id,
        `c${id}.com`,
        `https://c${id}.com`,
        o.state,
        o.brand,
        o.domain,
        o.dead ? 9 : 0,
        o.dead ? { status: "400" } : null,
      ],
    );
  }
  const ids = async (limit = 45) =>
    (
      await db.query<{ id: number }>(
        `SELECT id FROM list_brand_subscriber_priority_rescans($1, 24)`,
        [limit],
      )
    ).rows.map((r) => Number(r.id));

  it("agrees with entitlementsFor().priorityRescan on every combination (drift guard)", async () => {
    const statuses: Array<string | null> = [null, ...BRAND_SUBSCRIBER_STATUSES];
    const verifications = ["pending", "verified", "failed"];
    const plans: Array<string | null> = [
      null,
      "brand_pilot",
      "brand_enterprise",
    ];
    let n = 0;
    for (const status of statuses) {
      for (const verification of verifications) {
        for (const plan of plans) {
          for (const active of [true, false]) {
            // Combinations the schema forbids cannot occur in prod.
            if ((status === "active" || status === "lapsed") && plan === null)
              continue;
            await db.exec(
              `TRUNCATE monitored_brands; TRUNCATE shopfront_clone_alerts;`,
            );
            n++;
            await subscriber({
              status,
              verification,
              plan,
              active,
              domains: verification === "verified" ? ["acme.com.au"] : [],
            });
            await alert(1);
            const sql = (await ids()).includes(1);
            const ts = entitlementsFor({
              plan,
              subscriptionStatus: status,
              verificationStatus: verification,
              isActive: active,
            }).priorityRescan;
            expect({ status, verification, plan, active, sql }).toEqual({
              status,
              verification,
              plan,
              active,
              sql: ts,
            });
          }
        }
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  it("a never-rechecked lookalike is due (NULL is not 'recent')", async () => {
    await subscriber();
    await alert(1, { rechecked: null });
    expect(await ids()).toEqual([1]);
  });

  it("rotates: a row stamped within the cadence leaves the worklist, an overdue one stays", async () => {
    await subscriber();
    await alert(1, { rechecked: "now() - interval '25 hours'" });
    await alert(2, { rechecked: "now() - interval '2 hours'" });
    expect(await ids()).toEqual([1]);
    // The lane's mark_clone_alerts_rechecked stamp, simulated.
    await db.exec(
      `UPDATE shopfront_clone_alerts SET last_rechecked_at = now() WHERE id = 1`,
    );
    expect(await ids()).toEqual([]);
  });

  it("matches by legitimate domain as well as Canonical Brand key", async () => {
    await subscriber();
    await alert(1, { brand: null, domain: "acme.com.au" });
    await alert(2, { brand: "other", domain: "other.com" });
    expect(await ids()).toEqual([1]);
  });

  it("only live lookalikes: not weaponised/taken_down, not dead-dormant", async () => {
    await subscriber();
    await alert(1);
    await alert(2, { state: "declined" });
    await alert(3, { state: "weaponised" });
    await alert(4, { state: "taken_down" });
    await alert(5, { dead: true });
    expect(await ids()).toEqual([1, 2]);
  });

  it("stalest first, LIMIT honoured, due_total counted before the LIMIT", async () => {
    await subscriber();
    await alert(1, { rechecked: "now() - interval '30 hours'" });
    await alert(2, { rechecked: null });
    await alert(3, { rechecked: "now() - interval '40 hours'" });
    expect(await ids(2)).toEqual([2, 3]);
    const r = await db.query<{ due_total: number }>(
      `SELECT due_total FROM list_brand_subscriber_priority_rescans(1, 24)`,
    );
    expect(Number(r.rows[0].due_total)).toBe(3);
  });

  it("a lookalike two subscribers share is listed once", async () => {
    await subscriber();
    await subscriber({ org: OTHER_ORG });
    await alert(1);
    expect(await ids()).toEqual([1]);
  });
});
