import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Brand Monitor branch of the Stripe webhook + the brand checkout route
// (Brand activation 2/4 — mirrors extensionStripeWebhook.test.ts).
// Focus: provisioning writes the org-keyed brand_billing record + syncs
// monitored_brands.plan (never api_keys), and the double ownership gate
// (Stripe customer's user === metadata.user_id, who must hold billing:manage
// in metadata.org_id) refuses tampered metadata. Deletion is keyed on the
// STORED stripe_subscription_id, so forged metadata can't cancel another org.

const stripeMock = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: stripeMock,
  getOrCreateStripeCustomer: vi.fn(async () => "cus_test_1"),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const flagsState = vi.hoisted(() => ({ brandExposure: true }));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: flagsState,
}));
vi.mock("@/lib/auth", () => {
  class AuthUnavailableError extends Error {}
  return { AuthUnavailableError, getUser: vi.fn() };
});

interface MockState {
  customerOwner: string | null; // user_profiles.stripe_customer_id → id
  memberRole: string | null; // org_members row for (org, user); null = none
  orgExists: boolean;
  orgSettings: Record<string, unknown>; // organizations.settings for org-1
  orgUpdates: Array<Record<string, unknown>>;
  mbUpdates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }>;
  monitoredRows: number; // rows matched by the monitored_brands plan sync
}
const state: MockState = vi.hoisted(() => ({
  customerOwner: null,
  memberRole: null,
  orgExists: true,
  orgSettings: {},
  orgUpdates: [],
  mbUpdates: [],
  monitoredRows: 1,
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "stripe_event_log") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: { event_id: "evt_1" }, error: null })),
          update: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn(async () => ({ error: null })),
        };
      }
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: state.customerOwner ? { id: state.customerOwner } : null,
            error: null,
          })),
        };
      }
      if (table === "org_members") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: state.memberRole
              ? { role: state.memberRole, status: "active" }
              : null,
            error: null,
          })),
        };
      }
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn(function (this: Record<string, unknown>) {
            if (this._updatePatch) {
              state.orgUpdates.push(this._updatePatch as Record<string, unknown>);
              return Promise.resolve({ error: null });
            }
            return this;
          }),
          maybeSingle: vi.fn(async () => ({
            data: state.orgExists ? { settings: state.orgSettings } : null,
            error: null,
          })),
          update: vi.fn(function (this: Record<string, unknown>, patch: Record<string, unknown>) {
            this._updatePatch = patch;
            return this;
          }),
        };
      }
      if (table === "monitored_brands") {
        const builder: Record<string, unknown> = {
          _patch: null,
          _filters: [] as Array<[string, unknown]>,
          update: vi.fn(function (this: typeof builder, patch: Record<string, unknown>) {
            this._patch = patch;
            return this;
          }),
          eq: vi.fn(function (this: typeof builder, col: string, val: unknown) {
            (this._filters as Array<[string, unknown]>).push([col, val]);
            return this;
          }),
          select: vi.fn(function (this: typeof builder) {
            state.mbUpdates.push({
              patch: this._patch as Record<string, unknown>,
              filters: this._filters as Array<[string, unknown]>,
            });
            return Promise.resolve({
              data: Array.from({ length: state.monitoredRows }, (_, i) => ({ id: i + 1 })),
              error: null,
            });
          }),
          // The cancellation path awaits update().eq().eq() with no select().
          then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
            state.mbUpdates.push({
              patch: builder._patch as Record<string, unknown>,
              filters: builder._filters as Array<[string, unknown]>,
            });
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return builder;
      }
      if (table === "subscriptions") {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn(async () => ({ error: null })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { POST as checkoutPOST } from "@/app/api/brand/checkout/route";
import { getUser } from "@/lib/auth";
import { logger } from "@askarthur/utils/logger";

const PRICE_MONITOR = "price_brand_monitor_test";
const PRICE_MONITOR_PLUS = "price_brand_monitor_plus_test";

function makeWebhookReq(event: Record<string, unknown>) {
  stripeMock.webhooks.constructEvent.mockReturnValue(event);
  return new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "stripe-signature": "sig_test" },
  });
}

function brandSubEvent(
  type: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "evt_1",
    type,
    api_version: "2026-01-01",
    data: {
      object: {
        id: "sub_brand_1",
        customer: "cus_test_1",
        status: "active",
        current_period_end: 1_800_000_000,
        items: { data: [{ price: { id: PRICE_MONITOR } }] },
        metadata: { org_id: "org-1", user_id: "user-1", plan: "brand_monitor" },
        ...overrides,
      },
    },
  };
}

function brandBilling(state: Record<string, unknown>): Record<string, unknown> {
  const settings = state.settings as Record<string, unknown>;
  return settings.brand_billing as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  flagsState.brandExposure = true;
  state.customerOwner = "user-1";
  state.memberRole = "owner";
  state.orgExists = true;
  state.orgSettings = { existing_key: "keep-me" };
  state.orgUpdates = [];
  state.mbUpdates = [];
  state.monitoredRows = 1;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_MONTHLY = PRICE_MONITOR;
  process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_PLUS_MONTHLY = PRICE_MONITOR_PLUS;
  vi.mocked(getUser).mockResolvedValue({ id: "user-1", email: "u@example.com" } as never);
});

describe("webhook brand_monitor branch", () => {
  it("provisions on subscription.updated: brand_billing record + monitored_brands.plan sync", async () => {
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);

    expect(state.orgUpdates).toHaveLength(1);
    const billing = brandBilling(state.orgUpdates[0]);
    expect(billing).toMatchObject({
      plan: "brand_monitor",
      status: "active",
      stripe_subscription_id: "sub_brand_1",
      stripe_price_id: PRICE_MONITOR,
    });
    // Merges into settings rather than clobbering unrelated keys.
    expect((state.orgUpdates[0].settings as Record<string, unknown>).existing_key).toBe("keep-me");

    expect(state.mbUpdates).toHaveLength(1);
    expect(state.mbUpdates[0].patch.plan).toBe("brand_monitor");
    expect(state.mbUpdates[0].filters).toContainEqual(["org_id", "org-1"]);
    expect(state.mbUpdates[0].filters).toContainEqual(["is_active", true]);
  });

  it("resolves the plus price to brand_monitor_plus", async () => {
    const res = await webhookPOST(
      makeWebhookReq(
        brandSubEvent("customer.subscription.updated", {
          items: { data: [{ price: { id: PRICE_MONITOR_PLUS } }] },
          metadata: { org_id: "org-1", user_id: "user-1", plan: "brand_monitor_plus" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(brandBilling(state.orgUpdates[0]).plan).toBe("brand_monitor_plus");
  });

  it("refuses when the Stripe customer belongs to a different user (forged user_id)", async () => {
    state.customerOwner = "user-9";
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200); // Stripe shouldn't retry a metadata problem
    expect(state.orgUpdates).toHaveLength(0);
    expect(state.mbUpdates).toHaveLength(0);
  });

  it("refuses when the purchaser lacks billing:manage in the org (forged org_id)", async () => {
    state.memberRole = "viewer";
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);
    expect(state.orgUpdates).toHaveLength(0);
  });

  it("still records the billing ledger when the org has no monitored_brands rows yet", async () => {
    state.monitoredRows = 0;
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);
    expect(state.orgUpdates).toHaveLength(1);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("no active monitored_brands rows"),
      expect.objectContaining({ orgId: "org-1" }),
    );
  });

  it("records past_due in the ledger WITHOUT touching monitored_brands.plan (dunning grace)", async () => {
    const res = await webhookPOST(
      makeWebhookReq(brandSubEvent("customer.subscription.updated", { status: "past_due" })),
    );
    expect(res.status).toBe(200);
    expect(brandBilling(state.orgUpdates[0]).status).toBe("past_due");
    expect(state.mbUpdates).toHaveLength(0);
  });

  it("cancels on subscription.deleted, keyed on the STORED subscription id, clearing only this plan", async () => {
    state.orgSettings = {
      existing_key: "keep-me",
      brand_billing: {
        plan: "brand_monitor",
        status: "active",
        stripe_subscription_id: "sub_brand_1",
      },
    };
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.deleted")));
    expect(res.status).toBe(200);

    expect(brandBilling(state.orgUpdates[0]).status).toBe("canceled");
    expect(state.mbUpdates).toHaveLength(1);
    expect(state.mbUpdates[0].patch.plan).toBeNull();
    expect(state.mbUpdates[0].filters).toContainEqual(["org_id", "org-1"]);
    // A manually-provisioned brand_pilot row must survive the cancellation.
    expect(state.mbUpdates[0].filters).toContainEqual(["plan", "brand_monitor"]);
  });

  it("refuses deletion when the stored subscription id doesn't match (forged org_id)", async () => {
    state.orgSettings = {
      brand_billing: { plan: "brand_monitor", stripe_subscription_id: "sub_other_org" },
    };
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.deleted")));
    expect(res.status).toBe(200);
    expect(state.orgUpdates).toHaveLength(0);
    expect(state.mbUpdates).toHaveLength(0);
  });
});

describe("brand checkout route", () => {
  function makeCheckoutReq(body: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/brand/checkout", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }
  const ORG_ID = "5b9f0f2e-64a1-4bfa-9df0-1f2e3a4b5c6d";

  it("403s when the user is not a billing admin of the org", async () => {
    state.memberRole = "viewer";
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG_ID, plan: "brand_monitor" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_org_billing_admin");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("creates a GST-ready AUD checkout session with org/user/plan metadata", async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/sess_1",
    });
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG_ID, plan: "brand_monitor_plus" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("checkout.stripe.com");
    const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(args.line_items[0].price).toBe(PRICE_MONITOR_PLUS);
    expect(args.automatic_tax).toEqual({ enabled: true });
    expect(args.subscription_data.metadata).toEqual({
      org_id: ORG_ID,
      user_id: "user-1",
      plan: "brand_monitor_plus",
    });
    expect(args.success_url).toContain("/brand-exposure?billing=success");
  });

  it("rejects brand_pilot (manual provisioning only — no self-serve checkout)", async () => {
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG_ID, plan: "brand_pilot" }),
    );
    expect(res.status).toBe(400);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    vi.mocked(getUser).mockResolvedValue(null as never);
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG_ID, plan: "brand_monitor" }),
    );
    expect(res.status).toBe(401);
  });

  it("503s price_not_configured before the founder pastes the Stripe price IDs", async () => {
    delete process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_MONTHLY;
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG_ID, plan: "brand_monitor" }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("price_not_configured");
  });

  it("503s feature_disabled when FF_BRAND_EXPOSURE is off", async () => {
    flagsState.brandExposure = false;
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG_ID, plan: "brand_monitor" }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("feature_disabled");
  });
});
