import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Extension Pro branch of the Stripe webhook + the extension checkout route.
// Focus: provisioning writes extension_subscriptions (not api_keys), and the
// double ownership gate (Stripe customer's user === metadata.user_id ===
// the install's linked user) refuses tampered metadata.

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
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { extensionBilling: true },
}));
vi.mock("@/lib/auth", () => {
  class AuthUnavailableError extends Error {}
  return { AuthUnavailableError, getUser: vi.fn() };
});

interface MockState {
  customerOwner: string | null; // user_profiles.stripe_customer_id → id
  linkedUser: string | null; // extension_subscriptions.user_id for the install
  extUpserts: Array<Record<string, unknown>>;
  extUpdates: Array<{ patch: Record<string, unknown>; matchCol: string; matchVal: unknown }>;
}
const state: MockState = vi.hoisted(() => ({
  customerOwner: null,
  linkedUser: null,
  extUpserts: [],
  extUpdates: [],
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
      if (table === "extension_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn(function (this: unknown, col: string, val: unknown) {
            // Chained select().eq().maybeSingle() OR update().eq() terminal.
            const self = this as Record<string, unknown> & { _updatePatch?: Record<string, unknown> };
            if (self._updatePatch) {
              state.extUpdates.push({ patch: self._updatePatch, matchCol: col, matchVal: val });
              return Promise.resolve({ error: null });
            }
            return self;
          }),
          maybeSingle: vi.fn(async () => ({
            data: state.linkedUser ? { user_id: state.linkedUser, tier: "free" } : null,
            error: null,
          })),
          upsert: vi.fn(async (row: Record<string, unknown>) => {
            state.extUpserts.push(row);
            return { error: null };
          }),
          update: vi.fn(function (this: Record<string, unknown>, patch: Record<string, unknown>) {
            this._updatePatch = patch;
            return this;
          }),
        };
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
import { POST as checkoutPOST } from "@/app/api/extension/checkout/route";
import { getUser } from "@/lib/auth";

const PRICE_MONTHLY = "price_ext_monthly_test";

function makeWebhookReq(event: Record<string, unknown>) {
  stripeMock.webhooks.constructEvent.mockReturnValue(event);
  return new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "stripe-signature": "sig_test" },
  });
}

function extensionSubEvent(
  type: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "evt_1",
    type,
    api_version: "2026-01-01",
    data: {
      object: {
        id: "sub_ext_1",
        customer: "cus_test_1",
        status: "active",
        current_period_end: 1_800_000_000,
        items: { data: [{ price: { id: PRICE_MONTHLY } }] },
        metadata: { install_id: "install-a", user_id: "user-1", plan: "extension_pro" },
        ...overrides,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.customerOwner = "user-1";
  state.linkedUser = "user-1";
  state.extUpserts = [];
  state.extUpdates = [];
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.NEXT_PUBLIC_STRIPE_EXTENSION_PRO_MONTHLY = PRICE_MONTHLY;
  process.env.NEXT_PUBLIC_STRIPE_EXTENSION_PRO_ANNUAL = "price_ext_annual_test";
  vi.mocked(getUser).mockResolvedValue({ id: "user-1", email: "u@example.com" } as never);
});

describe("webhook extension_pro branch", () => {
  it("provisions pro on subscription.updated with matching ownership", async () => {
    const res = await webhookPOST(makeWebhookReq(extensionSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);
    expect(state.extUpserts).toHaveLength(1);
    expect(state.extUpserts[0]).toMatchObject({
      install_id: "install-a",
      user_id: "user-1",
      tier: "pro",
      status: "active",
      billing_provider: "stripe",
      stripe_subscription_id: "sub_ext_1",
      stripe_price_id: PRICE_MONTHLY,
    });
  });

  it("refuses when the install is linked to a DIFFERENT user (forged install_id)", async () => {
    state.linkedUser = "user-2";
    const res = await webhookPOST(makeWebhookReq(extensionSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200); // Stripe shouldn't retry a metadata problem
    expect(state.extUpserts).toHaveLength(0);
  });

  it("refuses when the Stripe customer belongs to a different user (forged user_id)", async () => {
    state.customerOwner = "user-9";
    const res = await webhookPOST(makeWebhookReq(extensionSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);
    expect(state.extUpserts).toHaveLength(0);
  });

  it("maps trialing → active and past_due → past_due (tier gate semantics)", async () => {
    await webhookPOST(makeWebhookReq(extensionSubEvent("customer.subscription.updated", { status: "trialing" })));
    expect(state.extUpserts[0]).toMatchObject({ status: "active" });
    await webhookPOST(makeWebhookReq(extensionSubEvent("customer.subscription.updated", { status: "past_due" })));
    expect(state.extUpserts[1]).toMatchObject({ status: "past_due" });
  });

  it("downgrades to free on subscription.deleted, keyed on subscription id", async () => {
    const res = await webhookPOST(makeWebhookReq(extensionSubEvent("customer.subscription.deleted")));
    expect(res.status).toBe(200);
    expect(state.extUpserts).toHaveLength(0);
    const update = state.extUpdates.find((u) => u.patch.tier === "free");
    expect(update).toBeDefined();
    expect(update!.patch.status).toBe("canceled");
    expect(update!.matchCol).toBe("stripe_subscription_id");
    expect(update!.matchVal).toBe("sub_ext_1");
  });

  it("marks extension row past_due on invoice.payment_failed", async () => {
    const res = await webhookPOST(
      makeWebhookReq({
        id: "evt_1",
        type: "invoice.payment_failed",
        data: { object: { subscription: "sub_ext_1" } },
      }),
    );
    expect(res.status).toBe(200);
    const update = state.extUpdates.find((u) => u.patch.status === "past_due");
    expect(update).toBeDefined();
    expect(update!.matchVal).toBe("sub_ext_1");
  });
});

describe("extension checkout route", () => {
  function makeCheckoutReq(body: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/extension/checkout", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  it("403s when the install is not linked to the logged-in user", async () => {
    state.linkedUser = "user-2";
    const res = await checkoutPOST(
      makeCheckoutReq({ installId: "install-a", interval: "monthly" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("install_not_linked");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("creates a checkout session with install/user metadata for a linked install", async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/sess_1",
    });
    const res = await checkoutPOST(
      makeCheckoutReq({ installId: "install-a", interval: "monthly" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("checkout.stripe.com");
    const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(args.line_items[0].price).toBe(PRICE_MONTHLY);
    expect(args.subscription_data.metadata).toEqual({
      install_id: "install-a",
      user_id: "user-1",
      plan: "extension_pro",
    });
    expect(args.success_url).toContain("/extension/link?success=1");
  });

  it("401s without a session", async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const res = await checkoutPOST(
      makeCheckoutReq({ installId: "install-a", interval: "monthly" }),
    );
    expect(res.status).toBe(401);
  });
});
