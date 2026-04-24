import "server-only";

// Phone Footprint SKU registry — maps Stripe price IDs to the entitlement
// shape that sync_phone_footprint_entitlements RPC expects. Lives in
// apps/web/lib because it reads NEXT_PUBLIC_STRIPE_PRICE_* envs and the
// scam-engine package is framework-free.
//
// Naming matches docs/ops/phone-footprint-config.md §2 Stripe Price IDs.
//
// When Stripe creates a new price, paste its ID into the appropriate
// env var (or add a new tier here) and the webhook will start tracking
// it automatically.

export type PhoneFootprintSku =
  | "pf_consumer_personal_monthly"
  | "pf_consumer_personal_annual"
  | "pf_consumer_family_monthly"
  | "pf_consumer_family_annual"
  | "pf_fleet_starter_monthly"
  | "pf_fleet_starter_annual"
  | "pf_fleet_enterprise";

export interface PhoneFootprintEntitlement {
  sku: PhoneFootprintSku;
  saved_numbers_limit: number;
  monthly_lookup_limit: number;
  refresh_cadence_min: "daily" | "weekly" | "monthly";
  features: {
    pdf: boolean;
    heartbeat: boolean; // SIM Swap Heartbeat push alerts
    claude: boolean;     // Claude-generated explanations
    batch: boolean;      // Batch API lookups
    webhook: boolean;    // Org webhook delivery
    fleet: boolean;      // Corporate fleet features (SSO, audit)
  };
  /** Whether this SKU belongs to an org (fleet) rather than a single user. */
  isFleet: boolean;
}

// Entitlement templates. Kept co-located with the SKU enum so changes
// here are a single-file review.
const ENTITLEMENTS: Record<PhoneFootprintSku, PhoneFootprintEntitlement> = {
  pf_consumer_personal_monthly: {
    sku: "pf_consumer_personal_monthly",
    saved_numbers_limit: 5,
    monthly_lookup_limit: 150,
    refresh_cadence_min: "monthly",
    features: { pdf: true, heartbeat: true, claude: true, batch: false, webhook: false, fleet: false },
    isFleet: false,
  },
  pf_consumer_personal_annual: {
    sku: "pf_consumer_personal_annual",
    saved_numbers_limit: 5,
    monthly_lookup_limit: 150,
    refresh_cadence_min: "monthly",
    features: { pdf: true, heartbeat: true, claude: true, batch: false, webhook: false, fleet: false },
    isFleet: false,
  },
  pf_consumer_family_monthly: {
    sku: "pf_consumer_family_monthly",
    saved_numbers_limit: 25,
    monthly_lookup_limit: 300,
    refresh_cadence_min: "monthly",
    features: { pdf: true, heartbeat: true, claude: true, batch: false, webhook: false, fleet: false },
    isFleet: false,
  },
  pf_consumer_family_annual: {
    sku: "pf_consumer_family_annual",
    saved_numbers_limit: 25,
    monthly_lookup_limit: 300,
    refresh_cadence_min: "monthly",
    features: { pdf: true, heartbeat: true, claude: true, batch: false, webhook: false, fleet: false },
    isFleet: false,
  },
  pf_fleet_starter_monthly: {
    sku: "pf_fleet_starter_monthly",
    saved_numbers_limit: 5_000,
    monthly_lookup_limit: 10_000,
    refresh_cadence_min: "weekly",
    features: { pdf: true, heartbeat: true, claude: true, batch: true, webhook: true, fleet: true },
    isFleet: true,
  },
  pf_fleet_starter_annual: {
    sku: "pf_fleet_starter_annual",
    saved_numbers_limit: 5_000,
    monthly_lookup_limit: 10_000,
    refresh_cadence_min: "weekly",
    features: { pdf: true, heartbeat: true, claude: true, batch: true, webhook: true, fleet: true },
    isFleet: true,
  },
  pf_fleet_enterprise: {
    sku: "pf_fleet_enterprise",
    // Enterprise numbers are contract-driven; these are ceilings at which we
    // start conversations, not hard caps. Billing team adjusts per tenancy.
    saved_numbers_limit: 100_000,
    monthly_lookup_limit: 500_000,
    refresh_cadence_min: "daily",
    features: { pdf: true, heartbeat: true, claude: true, batch: true, webhook: true, fleet: true },
    isFleet: true,
  },
};

/**
 * Resolve a Stripe price ID to a Phone Footprint entitlement template.
 * Returns null if the price isn't a PF SKU (so the webhook can skip).
 */
export function resolvePhoneFootprintEntitlement(
  priceId: string | null | undefined,
): PhoneFootprintEntitlement | null {
  if (!priceId) return null;
  const map: Record<string, PhoneFootprintSku> = {
    [process.env.STRIPE_PRICE_FOOTPRINT_PERSONAL_MONTHLY ?? ""]: "pf_consumer_personal_monthly",
    [process.env.STRIPE_PRICE_FOOTPRINT_PERSONAL_ANNUAL ?? ""]: "pf_consumer_personal_annual",
    [process.env.STRIPE_PRICE_FOOTPRINT_FAMILY_MONTHLY ?? ""]: "pf_consumer_family_monthly",
    [process.env.STRIPE_PRICE_FOOTPRINT_FAMILY_ANNUAL ?? ""]: "pf_consumer_family_annual",
    [process.env.STRIPE_PRICE_FLEET_STARTER_MONTHLY ?? ""]: "pf_fleet_starter_monthly",
    [process.env.STRIPE_PRICE_FLEET_STARTER_ANNUAL ?? ""]: "pf_fleet_starter_annual",
    [process.env.STRIPE_PRICE_FLEET_ENTERPRISE ?? ""]: "pf_fleet_enterprise",
  };
  // Defensive: drop the empty-string key so an unset env var can't match
  // an empty priceId coming through Stripe (shouldn't happen but robust).
  delete map[""];

  const sku = map[priceId];
  if (!sku) return null;
  return ENTITLEMENTS[sku];
}

export function isPhoneFootprintPrice(priceId: string | null | undefined): boolean {
  return resolvePhoneFootprintEntitlement(priceId) !== null;
}
