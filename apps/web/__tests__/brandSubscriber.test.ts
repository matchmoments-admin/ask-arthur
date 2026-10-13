import { describe, expect, it } from "vitest";
import {
  BRAND_SUBSCRIBER_STATUSES,
  ENTITLEMENT_PROMISES,
  NO_ENTITLEMENTS,
  entitlementsFor,
  parseOrgId,
  parseSubscriberId,
  pickSubscriber,
  routeBrandAlert,
  toBrandSubscriber,
  type BrandSubscriber,
} from "@/lib/clone-watch/brand-subscriber";

// The entitlement Module (#1295): plan + status + verification → what a brand
// gets. Exhaustive over every input the schema allows, plus the junk it
// doesn't (a mapping fed an unknown plan must answer "nothing", not throw).
//
// Go-reds (2026-10-13), each against an edited brand-subscriber.ts, reverted:
//   - entitlementsFor without the verification check failed "unverified …
//     gets nothing" (anyone could pay to receive another brand's alerts);
//   - ENTITLED_STATUSES with "pending" added failed the exhaustive table;
//   - routeBrandAlert ignoring entitlements failed "a canceled subscriber
//     falls back to the directory".

const PLANS = [
  "brand_pilot",
  "brand_monitor",
  "brand_monitor_plus",
  "brand_enterprise",
];
const EVERYTHING = {
  brandPage: true,
  monthlyReport: true,
  weaponisedAlert: true,
  priorityRescan: true,
  managedTakedowns: { counted: true, cap: null },
};

describe("entitlementsFor — exhaustive", () => {
  const statuses: Array<string | null> = [
    null,
    ...BRAND_SUBSCRIBER_STATUSES,
    "bogus",
  ];
  const verifications: Array<string | null> = [
    null,
    "pending",
    "verified",
    "failed",
  ];
  const plans: Array<string | null> = [null, ...PLANS, "brand_free"];
  const actives: Array<boolean | null> = [true, false, null];

  for (const subscriptionStatus of statuses) {
    for (const verificationStatus of verifications) {
      for (const plan of plans) {
        for (const isActive of actives) {
          const entitled =
            isActive === true &&
            verificationStatus === "verified" &&
            (subscriptionStatus === "active" ||
              subscriptionStatus === "lapsed") &&
            plan !== null &&
            PLANS.includes(plan);
          it(`${subscriptionStatus}/${verificationStatus}/${plan}/${isActive} → ${entitled ? "everything" : "nothing"}`, () => {
            expect(
              entitlementsFor({
                plan,
                subscriptionStatus,
                verificationStatus,
                isActive,
              }),
            ).toEqual(entitled ? EVERYTHING : NO_ENTITLEMENTS);
          });
        }
      }
    }
  }

  it("unverified paid row gets nothing (ownership not proved)", () => {
    expect(
      entitlementsFor({
        plan: "brand_monitor",
        subscriptionStatus: "active",
        verificationStatus: "pending",
        isActive: true,
      }).weaponisedAlert,
    ).toBe(false);
  });

  it("managed takedowns are counted and uncapped", () => {
    const e = entitlementsFor({
      plan: "brand_pilot",
      subscriptionStatus: "active",
      verificationStatus: "verified",
      isActive: true,
    });
    expect(e.managedTakedowns).toEqual({ counted: true, cap: null });
  });

  it("returns a copy — a caller mutating it cannot change the next answer", () => {
    const input = {
      plan: "brand_pilot",
      subscriptionStatus: "active",
      verificationStatus: "verified",
      isActive: true,
    };
    const a = entitlementsFor(input);
    a.weaponisedAlert = false;
    a.managedTakedowns.cap = 1;
    expect(entitlementsFor(input)).toEqual(EVERYTHING);
  });
});

function sub(over: Partial<BrandSubscriber> = {}): BrandSubscriber {
  return {
    id: 1,
    orgId: "org",
    brandName: "Acme",
    brandNormalized: "acme",
    legitimateDomains: ["acme.com.au"],
    plan: "brand_pilot",
    subscriptionStatus: "active",
    verificationStatus: "verified",
    isActive: true,
    alertContactEmail: "sec@acme.com.au",
    alertContactName: null,
    stripeSubscriptionId: null,
    activatedAt: null,
    ...over,
  };
}

describe("routeBrandAlert — the subscriber's contact outranks the directory", () => {
  it("routes an entitled subscriber with a contact to that contact", () => {
    expect(routeBrandAlert(sub(), "weaponisedAlert")).toEqual({
      kind: "subscriber",
      recipient: "sec@acme.com.au",
      subscriberId: 1,
      brandName: "Acme",
    });
  });
  it("no subscriber → directory", () => {
    expect(routeBrandAlert(null, "monthlyReport")).toEqual({
      kind: "directory",
      reason: "no_subscriber",
    });
  });
  it("a canceled subscriber falls back to the directory", () => {
    expect(
      routeBrandAlert(
        sub({ subscriptionStatus: "canceled" }),
        "weaponisedAlert",
      ),
    ).toEqual({ kind: "directory", reason: "not_entitled" });
  });
  it("an entitled subscriber with no contact falls back to the directory", () => {
    expect(
      routeBrandAlert(sub({ alertContactEmail: "  " }), "monthlyReport"),
    ).toEqual({
      kind: "directory",
      reason: "no_contact",
    });
  });
});

describe("pickSubscriber", () => {
  it("prefers an entitled row over an older unentitled one", () => {
    const pending = sub({ id: 1, subscriptionStatus: "pending" });
    const active = sub({ id: 2 });
    expect(pickSubscriber([pending, active])?.id).toBe(2);
  });
  it("prefers verified over an unverified competitor claiming the same brand", () => {
    const squatter = sub({ id: 1, verificationStatus: "pending" });
    const owner = sub({ id: 5 });
    expect(pickSubscriber([squatter, owner])?.id).toBe(5);
  });
  it("is deterministic on ties (oldest id) and null on empty", () => {
    expect(pickSubscriber([sub({ id: 9 }), sub({ id: 3 })])?.id).toBe(3);
    expect(pickSubscriber([])).toBeNull();
  });
});

describe("toBrandSubscriber", () => {
  it("a house-org watch row (no subscription status) is not a subscriber", () => {
    expect(
      toBrandSubscriber({
        id: 1,
        org_id: "00000000-0000-4000-8000-000000000001",
        brand_name: "X",
        brand_normalized: "x",
        legitimate_domains: ["x.com"],
        plan: null,
        subscription_status: null,
        verification_status: "verified",
        is_active: true,
        alert_contact_email: null,
        alert_contact_name: null,
        stripe_subscription_id: null,
        activated_at: null,
      }),
    ).toBeNull();
  });
});

describe("metadata parsers", () => {
  it("parseSubscriberId accepts only a positive integer string", () => {
    expect(parseSubscriberId("42")).toBe(42);
    for (const bad of ["0", "-1", "1.5", "1e3", "", "abc", undefined, 42]) {
      expect(parseSubscriberId(bad)).toBeNull();
    }
  });
  it("parseOrgId accepts only a uuid", () => {
    expect(parseOrgId("5b9f0f2e-64a1-4bfa-9df0-1f2e3a4b5c6d")).not.toBeNull();
    expect(parseOrgId("org-1")).toBeNull();
    expect(parseOrgId("x' or 1=1")).toBeNull();
  });
});

describe("ENTITLEMENT_PROMISES", () => {
  it("covers every entitlement, and never promises the brand page before #1302", () => {
    expect(Object.keys(ENTITLEMENT_PROMISES).sort()).toEqual(
      Object.keys(NO_ENTITLEMENTS).sort(),
    );
    expect(ENTITLEMENT_PROMISES.brandPage).toBeNull();
  });
});
