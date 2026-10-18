import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ADR-0020 / #1295: a Brand Subscriber has ONE key. Admin onboarding and
// self-serve checkout must derive brand_normalized identically, or the same
// brand onboarded by an operator and bought via checkout becomes two rows.
// Both routes run for real here; only I/O is mocked, with a brand_aliases
// layer where "CBA" and "CommBank" resolve to "Commonwealth Bank".
// Go-red (2026-10-13): against #1310's first head (admin = brandNormalize of
// the raw name, checkout = alias-resolved) "CBA" and "CommBank" FAILED.

const ALIASES: Record<string, string> = {
  cba: "Commonwealth Bank",
  commbank: "Commonwealth Bank",
  commonwealthbank: "Commonwealth Bank",
};

const keys = { admin: [] as string[], checkout: [] as string[] };

vi.mock("@/lib/adminAuth", () => ({
  requireAdmin: vi.fn(),
  getAdminUserId: vi.fn().mockResolvedValue("admin-1"),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: { brandExposure: true } }));
vi.mock("@/lib/auth", () => {
  class AuthUnavailableError extends Error {}
  return {
    AuthUnavailableError,
    getUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@example.com" }),
  };
});
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: "https://s" }) } } },
  getOrCreateStripeCustomer: vi.fn().mockResolvedValue("cus_1"),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "resolve_brand") {
        const k = String(args.p_raw).toLowerCase().replace(/[^a-z0-9]/g, "");
        return { data: ALIASES[k] ?? null, error: null };
      }
      if (fn === "upsert_pending_brand_subscriber") {
        keys.checkout.push(args.p_brand_normalized as string);
        return { data: [{ brand_subscriber_id: 1, outcome: "created" }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => (table === "org_members" && b._head ? Promise.resolve({ count: 2, error: null }) : b);
      b.insert = (row: Record<string, unknown>) => {
        keys.admin.push(row.brand_normalized as string);
        return b;
      };
      b.maybeSingle = async () =>
        table === "org_members"
          ? { data: { role: "owner", status: "active" }, error: null }
          : { data: { id: 1 }, error: null };
      // admin's member count uses select(…, {head:true}).eq(...)
      const sel = b.select as (...a: unknown[]) => unknown;
      b.select = (...a: unknown[]) => {
        const opts = a[1] as { head?: boolean } | undefined;
        if (opts?.head) b._head = true;
        return sel(...a);
      };
      return b;
    },
  }),
}));

import { POST as adminPOST } from "@/app/api/admin/brands/route";
import { POST as checkoutPOST } from "@/app/api/brand/checkout/route";

const ORG = "5b9f0f2e-64a1-4bfa-9df0-1f2e3a4b5c6d";
const post = (url: string, body: Record<string, unknown>) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  keys.admin.length = 0;
  keys.checkout.length = 0;
  process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_MONTHLY = "price_m";
});

describe("admin onboarding and checkout derive the same Brand Subscriber key", () => {
  for (const name of ["Commonwealth Bank", "CBA", "CommBank", "commbank.com.au", "Acme Shoes"]) {
    it(`"${name}"`, async () => {
      const a = await adminPOST(
        post("http://x/api/admin/brands", {
          orgId: ORG,
          brandName: name,
          legitimateDomains: ["commbank.com.au"],
          plan: "brand_pilot",
        }),
      );
      const c = await checkoutPOST(
        post("http://x/api/brand/checkout", {
          orgId: ORG,
          plan: "brand_monitor",
          brandName: name,
          primaryDomain: "commbank.com.au",
        }),
      );
      expect([a.status, c.status]).toEqual([200, 200]);
      expect(keys.admin).toHaveLength(1);
      expect(keys.admin[0]).toBe(keys.checkout[0]);
    });
  }

  it("aliases collapse to one key on both paths", () => {
    // Sanity on the fixture itself: the three bank names are one brand.
    expect(new Set(Object.values(ALIASES)).size).toBe(1);
  });
});
