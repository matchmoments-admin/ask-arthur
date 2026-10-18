import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #1295: console onboarding writes a Brand Subscriber for a customer org
// (manually billed pilot → active, with its alert contact) and a plain watch
// row for the house org (never a subscriber — v347 CHECK).
// Go-red (2026-10-13): against the pre-#1295 route both cases FAILED (no
// subscription_status / alert_contact_email was written at all).

vi.mock("@/lib/adminAuth", () => ({
  requireAdmin: vi.fn(),
  getAdminUserId: vi.fn().mockResolvedValue("admin-1"),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: async () => ({ data: null, error: null }), // resolve_brand: no alias
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () =>
        table === "org_members"
          ? Promise.resolve({ count: 2, error: null })
          : b;
      b.insert = (row: Record<string, unknown>) => {
        inserted.push(row);
        return b;
      };
      b.maybeSingle = async () => ({ data: { id: 1 }, error: null });
      return b;
    },
  }),
}));

import { POST } from "@/app/api/admin/brands/route";

const HOUSE = "00000000-0000-4000-8000-000000000001";
const CUSTOMER = "5b9f0f2e-64a1-4bfa-9df0-1f2e3a4b5c6d";
const req = (body: Record<string, unknown>) =>
  new NextRequest("http://x/api/admin/brands", {
    method: "POST",
    body: JSON.stringify(body),
  });
const BASE = {
  brandName: "Acme Shoes",
  legitimateDomains: ["acmeshoes.com.au"],
  plan: "brand_pilot",
};

beforeEach(() => {
  inserted.length = 0;
});

describe("admin brand onboarding (#1295)", () => {
  it("a customer org's row is an active, manually billed Brand Subscriber with its contact", async () => {
    const res = await POST(
      req({
        ...BASE,
        orgId: CUSTOMER,
        alertContactEmail: "Sec@AcmeShoes.com.au",
      }),
    );
    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      subscription_status: "active",
      billing_provider: "manual",
      alert_contact_email: "sec@acmeshoes.com.au",
    });
    // Verification is NOT skipped: entitlements wait for it.
    expect(inserted[0]).not.toHaveProperty("verification_status");
  });

  it("a house-org row is a watch row, never a subscriber", async () => {
    const res = await POST(
      req({ ...BASE, orgId: HOUSE, alertContactEmail: "x@y.com" }),
    );
    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      subscription_status: null,
      billing_provider: null,
      alert_contact_email: null,
    });
  });
});
