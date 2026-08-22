import { describe, it, expect, vi, beforeEach } from "vitest";

// Document Check billing — SKU registry, allowance resolver precedence, and
// the load-bearing convention: doc plans are a separate SKU axis that never
// touches api_keys.tier (a doc price must dispatch OUT of the webhook
// before the tier path — asserted here at the registry level, and the
// dispatch branch mirrors brand's early-return).

const envBackup = { ...process.env };
const orgState = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  fail: false,
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () =>
        orgState.fail
          ? { data: null, error: { message: "boom" } }
          : { data: { settings: orgState.settings }, error: null },
      ),
    })),
  })),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("server-only", () => ({}));

import {
  DOCUMENT_PLANS,
  documentPlanForPrice,
  documentPlanPriceId,
  isDocumentPlanPrice,
  mapStripeStatusToDocumentBillingStatus,
} from "@/lib/documentSkus";
import { documentAllowanceForOrg } from "@/lib/document-allowance";

beforeEach(() => {
  process.env = { ...envBackup };
  process.env.NEXT_PUBLIC_STRIPE_DOC_CHECK_STARTER_MONTHLY = "price_starter";
  process.env.NEXT_PUBLIC_STRIPE_DOC_CHECK_PRO_MONTHLY = "price_pro";
  orgState.settings = null;
  orgState.fail = false;
});

describe("documentSkus", () => {
  it("maps price IDs both directions; unset env means no plan matches", () => {
    expect(documentPlanPriceId("doc_starter")).toBe("price_starter");
    expect(documentPlanForPrice("price_pro")).toBe("doc_pro");
    expect(isDocumentPlanPrice("price_starter")).toBe(true);
    expect(isDocumentPlanPrice("price_unrelated")).toBe(false);

    delete process.env.NEXT_PUBLIC_STRIPE_DOC_CHECK_STARTER_MONTHLY;
    delete process.env.NEXT_PUBLIC_STRIPE_DOC_CHECK_PRO_MONTHLY;
    expect(documentPlanPriceId("doc_starter")).toBeNull();
    expect(isDocumentPlanPrice("price_starter")).toBe(false);
  });

  it("allowances match the locked pricing", () => {
    expect(DOCUMENT_PLANS.doc_starter).toEqual({
      monthlyPriceAud: 29,
      documentChecksPerMonth: 200,
    });
    expect(DOCUMENT_PLANS.doc_pro).toEqual({
      monthlyPriceAud: 99,
      documentChecksPerMonth: 1500,
    });
  });

  it("status mapping: only TRUE dunning keeps entitlement — incomplete/unpaid never grant", () => {
    expect(mapStripeStatusToDocumentBillingStatus("trialing")).toBe("active");
    expect(mapStripeStatusToDocumentBillingStatus("past_due")).toBe("past_due");
    // The review's two zero-payment holes: incomplete (first payment never
    // succeeded) and unpaid (terminal dunning, no deletion event fires).
    expect(mapStripeStatusToDocumentBillingStatus("incomplete")).toBe("paused");
    expect(mapStripeStatusToDocumentBillingStatus("unpaid")).toBe("canceled");
    expect(mapStripeStatusToDocumentBillingStatus("some_future_status")).toBe("canceled");
  });
});

describe("documentAllowanceForOrg", () => {
  it("no entitlement → tier fallback (business = 1500, free = 0)", async () => {
    expect(await documentAllowanceForOrg("org-1", "business")).toEqual({
      monthlyLimit: 1500,
      source: "tier",
      plan: null,
      degraded: false,
    });
    expect((await documentAllowanceForOrg("org-1", "free")).monthlyLimit).toBe(0);
  });

  it("an active doc plan wins over the tier — including for a FREE-tier key", async () => {
    orgState.settings = {
      document_billing: { plan: "doc_starter", status: "active", billing_provider: "manual" },
    };
    expect(await documentAllowanceForOrg("org-1", "free")).toEqual({
      monthlyLimit: 200,
      source: "document_plan",
      plan: "doc_starter",
      degraded: false,
    });
  });

  it("MAX, never replace: a doc plan can't shrink a higher tier's allowance, and cancelling isn't an upgrade", async () => {
    // Enterprise tier grants 10,000 — doc_starter (200) must not shrink it.
    orgState.settings = {
      document_billing: { plan: "doc_starter", status: "active", billing_provider: "stripe" },
    };
    const withPlan = await documentAllowanceForOrg("org-1", "enterprise");
    expect(withPlan.monthlyLimit).toBe(10000);
    expect(withPlan.source).toBe("tier");
    // Equal-or-greater plan wins with its identity.
    const proOverPro = await documentAllowanceForOrg("org-1", "pro");
    expect(proOverPro).toEqual({
      monthlyLimit: 200,
      source: "document_plan",
      plan: "doc_starter",
      degraded: false,
    });
  });

  it("past_due keeps the allowance (dunning grace); canceled falls back", async () => {
    orgState.settings = {
      document_billing: { plan: "doc_pro", status: "past_due", billing_provider: "stripe" },
    };
    expect((await documentAllowanceForOrg("org-1", "free")).monthlyLimit).toBe(1500);

    orgState.settings = {
      document_billing: { plan: "doc_pro", status: "canceled", billing_provider: "stripe" },
    };
    expect((await documentAllowanceForOrg("org-1", "pro")).source).toBe("tier");
  });

  it("lookup failure degrades to the tier fallback AND flags degraded (route maps degraded-zero to 503, not 402)", async () => {
    orgState.fail = true;
    expect(await documentAllowanceForOrg("org-1", "pro")).toEqual({
      monthlyLimit: 200,
      source: "tier",
      plan: null,
      degraded: true,
    });
    expect(await documentAllowanceForOrg("org-1", "free")).toEqual({
      monthlyLimit: 0,
      source: "tier",
      plan: null,
      degraded: true,
    });
  });

  it("an unknown plan value in the record falls back rather than granting", async () => {
    orgState.settings = {
      document_billing: { plan: "doc_mega", status: "active", billing_provider: "manual" },
    };
    expect((await documentAllowanceForOrg("org-1", "free")).monthlyLimit).toBe(0);
  });
});
