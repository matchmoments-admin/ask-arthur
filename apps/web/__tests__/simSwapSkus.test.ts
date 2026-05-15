import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveSimSwapSku,
  isSimSwapPrice,
  getSimSwapSkuMeta,
} from "@/lib/simSwapSkus";

// Locks the SKU resolver against three subtle bugs the existing
// resolvePhoneFootprintEntitlement helper had to defend against:
//
//   1. Empty string priceId must NOT match an unset env var. Without
//      the defensive `delete m[""]`, every priceId="" would resolve
//      to whichever env was assigned last in the literal map.
//   2. Stripe might send price IDs we don't recognise (legacy SKUs,
//      typos in the dashboard). Those must return null, not throw.
//   3. The bucket/reason/credits fields must align with the v123/v126
//      schema (bucket IN paid|recovery; reason IN purchase_5pack|
//      purchase_recovery). A drift here means Stripe payments accept
//      without granting credits.

describe("resolveSimSwapSku", () => {
  beforeEach(() => {
    delete process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK;
    delete process.env.STRIPE_PRICE_SIM_SWAP_RECOVERY_CHECK;
  });
  afterEach(() => {
    delete process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK;
    delete process.env.STRIPE_PRICE_SIM_SWAP_RECOVERY_CHECK;
  });

  it("returns null when both env vars are unset (no false-positive '' match)", () => {
    expect(resolveSimSwapSku("price_random")).toBeNull();
    expect(resolveSimSwapSku("")).toBeNull();
    expect(resolveSimSwapSku(null)).toBeNull();
    expect(resolveSimSwapSku(undefined)).toBeNull();
  });

  it("resolves the 5-pack SKU when its env var matches", () => {
    process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK = "price_5pack_aud";
    const meta = resolveSimSwapSku("price_5pack_aud");
    expect(meta).toMatchObject({
      sku: "sim_swap_credits_5pack",
      bucket: "paid",
      credits: 5,
      ledgerReason: "purchase_5pack",
    });
  });

  it("resolves the recovery SKU when its env var matches", () => {
    process.env.STRIPE_PRICE_SIM_SWAP_RECOVERY_CHECK = "price_recov_aud";
    const meta = resolveSimSwapSku("price_recov_aud");
    expect(meta).toMatchObject({
      sku: "sim_swap_recovery_check",
      bucket: "recovery",
      credits: 1,
      ledgerReason: "purchase_recovery",
    });
  });

  it("returns null for an unknown priceId even when envs are set", () => {
    process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK = "price_5pack";
    expect(resolveSimSwapSku("price_unknown")).toBeNull();
  });

  it("isSimSwapPrice mirrors resolveSimSwapSku", () => {
    process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK = "price_5pack";
    expect(isSimSwapPrice("price_5pack")).toBe(true);
    expect(isSimSwapPrice("price_other")).toBe(false);
    expect(isSimSwapPrice("")).toBe(false);
  });

  it("getSimSwapSkuMeta surfaces canonical pricing display info", () => {
    expect(getSimSwapSkuMeta("sim_swap_credits_5pack").unitAmountCents).toBe(99);
    expect(getSimSwapSkuMeta("sim_swap_recovery_check").unitAmountCents).toBe(499);
  });
});
