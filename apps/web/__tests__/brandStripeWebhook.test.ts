import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Brand Monitor branch of the Stripe webhook + the brand checkout route
// (Brand activation 2/4 — mirrors extensionStripeWebhook.test.ts).
// Focus: provisioning writes the org-keyed brand_billing record + applies the
// state to the Brand Subscriber via apply_brand_subscription (v347, #1295 —
// never api_keys), a payment that cannot attach lands in the unmatched queue
// (record_brand_unmatched_payment), and the double ownership gate
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
  orgSettings: Record<string, unknown>; // organizations.settings for ORG
  orgUpdates: Array<Record<string, unknown>>;
  applies: Array<Record<string, unknown>>; // apply_brand_subscription args
  matched: number; // rows apply_brand_subscription reports
  unmatched: Array<Record<string, unknown>>; // record_brand_unmatched_payment args
  pendings: Array<Record<string, unknown>>; // upsert_pending_brand_subscriber args
  pendingOutcome: string;
  canonical: string | null; // resolve_brand result
}
const state: MockState = vi.hoisted(() => ({
  customerOwner: null,
  memberRole: null,
  orgExists: true,
  orgSettings: {},
  orgUpdates: [],
  applies: [],
  matched: 1,
  unmatched: [],
  pendings: [],
  pendingOutcome: "created",
  canonical: null,
}));

// #1304: activation seeds the subscriber's known_brands row. Go-red
// (2026-10-13): against the pre-#1304 webhook "an activated Brand Subscriber
// gets its known_brands row seeded" FAILED (never called). The seed Module is
// tested on its own (knownBrandSeed.test.ts); here only "when is it called".
const seedMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ outcome: string; knownBrandId: number | null; probeRequested: boolean }> => ({
      outcome: "created",
      knownBrandId: 1,
      probeRequested: true,
    }),
  ),
);
vi.mock("@/lib/clone-watch/known-brand-seed", () => ({
  seedKnownBrandForSubscriber: seedMock,
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "apply_brand_subscription") {
        state.applies.push(args);
        return { data: state.matched, error: null };
      }
      if (fn === "record_brand_unmatched_payment") {
        state.unmatched.push(args);
        return { data: 1, error: null };
      }
      if (fn === "resolve_brand") return { data: state.canonical, error: null };
      if (fn === "upsert_pending_brand_subscriber") {
        state.pendings.push(args);
        return {
          data: [{ brand_subscriber_id: 77, outcome: state.pendingOutcome }],
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${fn}`);
    }),
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
const ORG = "5b9f0f2e-64a1-4bfa-9df0-1f2e3a4b5c6d";
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
        metadata: {
          org_id: ORG,
          user_id: "user-1",
          plan: "brand_monitor",
          brand_subscriber_id: "77",
        },
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
  state.applies = [];
  state.matched = 1;
  state.unmatched = [];
  state.pendings = [];
  state.pendingOutcome = "created";
  state.canonical = null;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_MONTHLY = PRICE_MONITOR;
  process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_PLUS_MONTHLY = PRICE_MONITOR_PLUS;
  vi.mocked(getUser).mockResolvedValue({ id: "user-1", email: "u@example.com" } as never);
});

describe("webhook brand_monitor branch", () => {
  it("provisions on subscription.updated: brand_billing record + activates the checkout's Brand Subscriber", async () => {
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

    expect(state.applies).toEqual([
      {
        p_org_id: ORG,
        p_brand_subscriber_id: 77,
        p_stripe_subscription_id: "sub_brand_1",
        p_plan: "brand_monitor",
        p_billing_status: "active",
      },
    ]);
    expect(state.unmatched).toHaveLength(0);
  });

  it("#1304: an activated Brand Subscriber gets its known_brands row seeded", async () => {
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);
    expect(seedMock).toHaveBeenCalledTimes(1);
    expect(seedMock).toHaveBeenCalledWith(expect.anything(), { brandSubscriberId: 77 });
  });

  it("#1304: no seed for past_due, for an unmatched payment, or without a subscriber id", async () => {
    await webhookPOST(
      makeWebhookReq(brandSubEvent("customer.subscription.updated", { status: "past_due" })),
    );
    state.matched = 0;
    await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    state.matched = 1;
    await webhookPOST(
      makeWebhookReq(
        brandSubEvent("customer.subscription.updated", {
          metadata: { org_id: ORG, user_id: "user-1", plan: "brand_monitor" },
        }),
      ),
    );
    expect(seedMock).not.toHaveBeenCalled();
  });

  it("#1304: a failed seed does not fail the webhook", async () => {
    seedMock.mockResolvedValueOnce({ outcome: "failed", knownBrandId: null, probeRequested: false });
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);
  });

  it("resolves the plus price to brand_monitor_plus", async () => {
    const res = await webhookPOST(
      makeWebhookReq(
        brandSubEvent("customer.subscription.updated", {
          items: { data: [{ price: { id: PRICE_MONITOR_PLUS } }] },
          metadata: { org_id: ORG, user_id: "user-1", plan: "brand_monitor_plus" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(brandBilling(state.orgUpdates[0]).plan).toBe("brand_monitor_plus");
    // A pre-#1295 session has no subscriber id: matched by subscription only.
    expect(state.applies[0].p_brand_subscriber_id).toBeNull();
  });

  it("refuses when the Stripe customer belongs to a different user (forged user_id) — and queues it", async () => {
    state.customerOwner = "user-9";
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200); // Stripe shouldn't retry a metadata problem
    expect(state.orgUpdates).toHaveLength(0);
    expect(state.applies).toHaveLength(0);
    expect(state.unmatched).toEqual([
      expect.objectContaining({ p_reason: "ownership_mismatch", p_stripe_subscription_id: "sub_brand_1" }),
    ]);
  });

  it("refuses when the purchaser lacks billing:manage in the org (forged org_id)", async () => {
    state.memberRole = "viewer";
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);
    expect(state.orgUpdates).toHaveLength(0);
    expect(state.unmatched[0]?.p_reason).toBe("ownership_mismatch");
  });

  it("a payment with missing metadata is queued, not just logged", async () => {
    const res = await webhookPOST(
      makeWebhookReq(brandSubEvent("customer.subscription.updated", { metadata: {} })),
    );
    expect(res.status).toBe(200);
    expect(state.unmatched[0]?.p_reason).toBe("missing_metadata");
  });

  it("a payment for an unknown org is queued", async () => {
    state.orgExists = false;
    await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(state.unmatched[0]?.p_reason).toBe("unknown_org");
    expect(state.applies).toHaveLength(0);
  });

  it("paid with no Brand Subscriber to attach to: ledger written AND the payment queued for an operator", async () => {
    state.matched = 0;
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.updated")));
    expect(res.status).toBe(200);
    expect(state.orgUpdates).toHaveLength(1);
    expect(state.unmatched).toEqual([
      {
        p_stripe_subscription_id: "sub_brand_1",
        p_stripe_customer_id: "cus_test_1",
        p_org_id: ORG,
        p_brand_subscriber_id: 77,
        p_plan: "brand_monitor",
        p_billing_status: "active",
        p_reason: "no_subscriber_row",
      },
    ]);
  });

  it("past_due is passed through as billing status (the RPC makes active rows lapsed — dunning grace)", async () => {
    const res = await webhookPOST(
      makeWebhookReq(brandSubEvent("customer.subscription.updated", { status: "past_due" })),
    );
    expect(res.status).toBe(200);
    expect(brandBilling(state.orgUpdates[0]).status).toBe("past_due");
    expect(state.applies[0].p_billing_status).toBe("past_due");
  });

  it("cancels on subscription.deleted, keyed on the STORED subscription id only", async () => {
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
    // brand_subscriber_id from metadata is NOT used: deletion is keyed on the
    // subscription the provisioning write stored, so a manual pilot (no Stripe
    // subscription) survives.
    expect(state.applies).toEqual([
      {
        p_org_id: ORG,
        p_brand_subscriber_id: null,
        p_stripe_subscription_id: "sub_brand_1",
        p_plan: "brand_monitor",
        p_billing_status: "canceled",
      },
    ]);
  });

  it("refuses deletion when the stored subscription id doesn't match (forged org_id)", async () => {
    state.orgSettings = {
      brand_billing: { plan: "brand_monitor", stripe_subscription_id: "sub_other_org" },
    };
    const res = await webhookPOST(makeWebhookReq(brandSubEvent("customer.subscription.deleted")));
    expect(res.status).toBe(200);
    expect(state.orgUpdates).toHaveLength(0);
    expect(state.applies).toHaveLength(0);
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
  const BRAND = { brandName: "Acme Shoes", primaryDomain: "https://www.AcmeShoes.com.au/shop" };

  it("403s when the user is not a billing admin of the org — and creates no pending row", async () => {
    state.memberRole = "viewer";
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG, plan: "brand_monitor", ...BRAND }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_org_billing_admin");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(state.pendings).toHaveLength(0);
  });

  it("creates the pending Brand Subscriber BEFORE the session and carries its id in metadata", async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/sess_1",
    });
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG, plan: "brand_monitor_plus", ...BRAND }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("checkout.stripe.com");
    expect(state.pendings).toEqual([
      {
        p_org_id: ORG,
        p_brand_name: "Acme Shoes",
        p_brand_normalized: "acmeshoes",
        p_primary_domain: "acmeshoes.com.au",
        p_plan: "brand_monitor_plus",
        p_alert_contact_email: "u@example.com", // defaults to the purchaser
        p_created_by: "user-1",
      },
    ]);
    const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(args.line_items[0].price).toBe(PRICE_MONITOR_PLUS);
    expect(args.automatic_tax).toEqual({ enabled: true });
    expect(args.subscription_data.metadata).toEqual({
      org_id: ORG,
      user_id: "user-1",
      plan: "brand_monitor_plus",
      brand_subscriber_id: "77",
    });
    expect(args.success_url).toContain("/brand-exposure?billing=success");
  });

  it("keys the subscriber on the Canonical Brand (ADR-0020), not the typed name", async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: "https://x" });
    state.canonical = "Australia Post";
    await checkoutPOST(
      makeCheckoutReq({
        orgId: ORG,
        plan: "brand_monitor",
        brandName: "AusPost",
        primaryDomain: "auspost.com.au",
        alertContactEmail: "Fraud@AusPost.com.au",
      }),
    );
    expect(state.pendings[0]).toMatchObject({
      p_brand_name: "AusPost",
      p_brand_normalized: "australiapost",
      p_alert_contact_email: "fraud@auspost.com.au",
    });
  });

  it("409s an already-subscribed brand and opens no second Stripe session", async () => {
    state.pendingOutcome = "already_subscribed";
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG, plan: "brand_monitor", ...BRAND }),
    );
    expect(res.status).toBe(409);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("400s without a brand name or with a non-domain", async () => {
    for (const body of [
      { orgId: ORG, plan: "brand_monitor", primaryDomain: "acme.com.au" },
      { orgId: ORG, plan: "brand_monitor", brandName: "Acme", primaryDomain: "not a domain" },
      { orgId: ORG, plan: "brand_monitor", brandName: "Acme", primaryDomain: "acme.com.au", alertContactEmail: "nope" },
    ]) {
      const res = await checkoutPOST(makeCheckoutReq(body));
      expect(res.status).toBe(400);
    }
    expect(state.pendings).toHaveLength(0);
  });

  it("rejects brand_pilot (manual provisioning only — no self-serve checkout)", async () => {
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG, plan: "brand_pilot", ...BRAND }),
    );
    expect(res.status).toBe(400);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    vi.mocked(getUser).mockResolvedValue(null as never);
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG, plan: "brand_monitor", ...BRAND }),
    );
    expect(res.status).toBe(401);
  });

  it("503s price_not_configured before the founder pastes the Stripe price IDs", async () => {
    delete process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_MONTHLY;
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG, plan: "brand_monitor", ...BRAND }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("price_not_configured");
    expect(state.pendings).toHaveLength(0);
  });

  it("503s feature_disabled when FF_BRAND_EXPOSURE is off", async () => {
    flagsState.brandExposure = false;
    const res = await checkoutPOST(
      makeCheckoutReq({ orgId: ORG, plan: "brand_monitor", ...BRAND }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("feature_disabled");
  });
});
