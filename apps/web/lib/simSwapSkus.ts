import "server-only";

// SIM Swap credit-pack SKU registry. Mirrors the shape of
// phoneFootprintSkus.ts but represents *one-time* purchases (Stripe
// Checkout mode='payment'), not subscriptions.
//
// Two SKUs in v1:
//   sim_swap_credits_5pack    — 5 standard checks for AUD $0.99
//   sim_swap_recovery_check   — 1 KYC-gated emergency check for AUD $4.99
//                               (for users whose SIM is already gone and
//                                cannot pass Twilio Verify OTP)
//
// When Stripe creates the prices, paste the IDs into the matching env
// vars (STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK,
// STRIPE_PRICE_SIM_SWAP_RECOVERY_CHECK) and the webhook + checkout
// helpers below will start tracking them.

export type SimSwapSku = "sim_swap_credits_5pack" | "sim_swap_recovery_check";

export interface SimSwapSkuMeta {
  sku: SimSwapSku;
  /** Bucket the credit goes into on `sim_swap_credit_ledger`. */
  bucket: "paid" | "recovery";
  /** Number of credits added on successful checkout. */
  credits: number;
  /** Ledger `reason` value for the credit row. */
  ledgerReason: "purchase_5pack" | "purchase_recovery";
  /** Display copy. */
  label: string;
  /** Price in AUD cents — for UI rendering only; Stripe holds source of truth. */
  unitAmountCents: number;
}

const META: Record<SimSwapSku, SimSwapSkuMeta> = {
  sim_swap_credits_5pack: {
    sku: "sim_swap_credits_5pack",
    bucket: "paid",
    credits: 5,
    ledgerReason: "purchase_5pack",
    label: "5 SIM-swap checks",
    unitAmountCents: 99,
  },
  sim_swap_recovery_check: {
    sku: "sim_swap_recovery_check",
    bucket: "recovery",
    credits: 1,
    ledgerReason: "purchase_recovery",
    label: "Emergency SIM-swap check (recovery flow)",
    unitAmountCents: 499,
  },
};

function priceIdMap(): Record<string, SimSwapSku> {
  const m: Record<string, SimSwapSku> = {
    [process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK ?? ""]:
      "sim_swap_credits_5pack",
    [process.env.STRIPE_PRICE_SIM_SWAP_RECOVERY_CHECK ?? ""]:
      "sim_swap_recovery_check",
  };
  // Defensive: drop empty-string keys so an unset env var can't match a
  // missing priceId. Same pattern as resolvePhoneFootprintEntitlement.
  delete m[""];
  return m;
}

/**
 * Resolve a Stripe price ID to its SIM Swap SKU metadata. Returns null
 * when the price isn't a SIM Swap product, so the webhook can skip it.
 */
export function resolveSimSwapSku(
  priceId: string | null | undefined,
): SimSwapSkuMeta | null {
  if (!priceId) return null;
  const sku = priceIdMap()[priceId];
  if (!sku) return null;
  return META[sku];
}

/** Tiny boolean wrapper for symmetry with isPhoneFootprintPrice. */
export function isSimSwapPrice(priceId: string | null | undefined): boolean {
  return resolveSimSwapSku(priceId) !== null;
}

export function getSimSwapSkuMeta(sku: SimSwapSku): SimSwapSkuMeta {
  return META[sku];
}
