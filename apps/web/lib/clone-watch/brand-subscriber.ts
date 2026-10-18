/**
 * The Brand Subscriber Module (#1295) — the ONE answer to "what does this
 * brand get right now".
 *
 * A Brand Subscriber is a `monitored_brands` row (v207 → reshaped v347): one
 * per (org, Canonical Brand), carrying the legitimate domains, the alert
 * contact and a subscription status. Billing stays on the org
 * (`organizations.settings.brand_billing`) because one Brand Monitor+
 * subscription covers up to three brands. The key is the ADR-0020 Canonical
 * Brand (`brand_normalized`) — never `deriveBrandKey`.
 *
 * Interface:
 *   - `entitlementsFor(row)`        pure: plan + status + verification → entitlements
 *   - `routeBrandAlert(sub, need)`  pure: the subscriber's contact outranks
 *                                   brand_contact_directory when entitled
 *   - `loadBrandSubscriber(sb, …)`  Adapter: the subscriber for a brand key / domain
 *   - `loadOrgBrandSubscribers`     Adapter: an org's subscribers (the brand page, #1302)
 *   - checkout / webhook writes     Adapters over the v347 RPCs
 *
 * Every entitlement is a behaviour some code checks:
 *   brandPage        — the logged-in brand page (#1302 reads this)
 *   monthlyReport    — the monthly evidence report goes to the subscriber's
 *                      contact (brand-stewardship send route)
 *   weaponisedAlert  — the weaponised alert routes to the subscriber's contact
 *                      (clone-watch-notify-weaponised), shadowed until #371
 *   priorityRescan   — daily priority rescan of live lookalikes
 *                      (list_brand_subscriber_priority_rescans, v347; the SQL
 *                      predicate is held to this mapping by
 *                      brandSubscriberSql.test.ts)
 *   managedTakedowns — counted, not capped yet (cap: null)
 *
 * No runtime import beyond types, so the public pricing component can read
 * the promise copy without pulling in a database client.
 */

import type { BrandPlanKey } from "@askarthur/types/billing";
import type { createServiceClient } from "@askarthur/supabase/server";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const BRAND_SUBSCRIBER_STATUSES = [
  "pending",
  "active",
  "lapsed",
  "canceled",
] as const;
export type BrandSubscriberStatus = (typeof BRAND_SUBSCRIBER_STATUSES)[number];

/** v256's reserved house org: brands Ask Arthur watches on its own evidence.
 *  Its rows are never subscribers (v347 CHECK monitored_brands_house_not_subscriber). */
export const HOUSE_ORG_ID = "00000000-0000-4000-8000-000000000001";

const BRAND_PLAN_KEYS: readonly BrandPlanKey[] = [
  "brand_pilot",
  "brand_monitor",
  "brand_monitor_plus",
  "brand_enterprise",
];

export function isBrandPlanKey(v: unknown): v is BrandPlanKey {
  return (
    typeof v === "string" && (BRAND_PLAN_KEYS as readonly string[]).includes(v)
  );
}

// ── Entitlements ────────────────────────────────────────────────────────────

export interface BrandEntitlements {
  brandPage: boolean;
  monthlyReport: boolean;
  weaponisedAlert: boolean;
  priorityRescan: boolean;
  /** Escalation beyond the free Netcraft report. Counted and shown; `cap`
   *  null = not capped (founder decision, #1295). */
  managedTakedowns: { counted: boolean; cap: number | null };
}
export type EntitlementName = keyof BrandEntitlements;

export const NO_ENTITLEMENTS: Readonly<BrandEntitlements> = Object.freeze({
  brandPage: false,
  monthlyReport: false,
  weaponisedAlert: false,
  priorityRescan: false,
  managedTakedowns: Object.freeze({ counted: false, cap: 0 }),
});

const EVERYTHING: Readonly<BrandEntitlements> = Object.freeze({
  brandPage: true,
  monthlyReport: true,
  weaponisedAlert: true,
  priorityRescan: true,
  managedTakedowns: Object.freeze({ counted: true, cap: null }),
});

/**
 * What each plan unlocks. Pricing is in fog (#1295 decision 5), so today every
 * plan unlocks the same five behaviours; differentiating a tier later is a
 * line here, not a hunt through the send paths.
 */
export const PLAN_ENTITLEMENTS: Readonly<
  Record<BrandPlanKey, Readonly<BrandEntitlements>>
> = Object.freeze({
  brand_pilot: EVERYTHING,
  brand_monitor: EVERYTHING,
  brand_monitor_plus: EVERYTHING,
  brand_enterprise: EVERYTHING,
});

/** `lapsed` = Stripe past_due/paused: dunning grace keeps the entitlements
 *  (the webhook's pre-v347 semantics — past_due never cleared the plan). */
export const ENTITLED_STATUSES: ReadonlySet<BrandSubscriberStatus> = new Set([
  "active",
  "lapsed",
]);

export interface SubscriberEntitlementInput {
  plan: string | null;
  subscriptionStatus: string | null;
  verificationStatus: string | null;
  isActive: boolean | null;
}

/**
 * Pure. A row is entitled only when it is active, VERIFIED (ownership proved —
 * otherwise anyone could pay to receive another brand's lookalike alerts),
 * in an entitled status, and on a known plan. Anything else gets nothing.
 */
export function entitlementsFor(
  row: SubscriberEntitlementInput,
): BrandEntitlements {
  if (row.isActive !== true) return copy(NO_ENTITLEMENTS);
  if (row.verificationStatus !== "verified") return copy(NO_ENTITLEMENTS);
  if (!ENTITLED_STATUSES.has(row.subscriptionStatus as BrandSubscriberStatus)) {
    return copy(NO_ENTITLEMENTS);
  }
  if (!isBrandPlanKey(row.plan)) return copy(NO_ENTITLEMENTS);
  return copy(PLAN_ENTITLEMENTS[row.plan]);
}

function copy(e: Readonly<BrandEntitlements>): BrandEntitlements {
  return { ...e, managedTakedowns: { ...e.managedTakedowns } };
}

/**
 * What the public pricing copy may promise, per entitlement. `null` = not
 * promised: the brand page does not exist until #1302 ships. The pricing
 * component renders exactly the non-null lines, so a promise cannot appear
 * without an entitlement behind it (brandProtectionTiers.test.tsx).
 */
export const ENTITLEMENT_PROMISES: Readonly<
  Record<EntitlementName, string | null>
> = {
  brandPage: null,
  priorityRescan:
    "Your brand's live lookalikes rescanned daily, ahead of the general queue",
  weaponisedAlert:
    "An urgent alert to your team when a lookalike starts serving phishing",
  monthlyReport: "A monthly evidence report on your brand's lookalikes",
  managedTakedowns:
    "Managed takedown escalation beyond the free Netcraft report",
};

// ── The record ──────────────────────────────────────────────────────────────

export interface BrandSubscriber {
  id: number;
  orgId: string;
  brandName: string;
  brandNormalized: string;
  legitimateDomains: string[];
  plan: string | null;
  subscriptionStatus: BrandSubscriberStatus;
  verificationStatus: string;
  isActive: boolean;
  alertContactEmail: string | null;
  alertContactName: string | null;
  stripeSubscriptionId: string | null;
  activatedAt: string | null;
}

export const SUBSCRIBER_COLUMNS =
  "id, org_id, brand_name, brand_normalized, legitimate_domains, plan, subscription_status, verification_status, is_active, alert_contact_email, alert_contact_name, stripe_subscription_id, activated_at";

interface SubscriberRow {
  id: number;
  org_id: string;
  brand_name: string;
  brand_normalized: string;
  legitimate_domains: string[] | null;
  plan: string | null;
  subscription_status: string | null;
  verification_status: string;
  is_active: boolean;
  alert_contact_email: string | null;
  alert_contact_name: string | null;
  stripe_subscription_id: string | null;
  activated_at: string | null;
}

/** Row → record. A row with no subscription status (a house-org watch row)
 *  is not a subscriber: null. */
export function toBrandSubscriber(r: SubscriberRow): BrandSubscriber | null {
  if (
    !BRAND_SUBSCRIBER_STATUSES.includes(
      r.subscription_status as BrandSubscriberStatus,
    )
  ) {
    return null;
  }
  return {
    id: Number(r.id),
    orgId: r.org_id,
    brandName: r.brand_name,
    brandNormalized: r.brand_normalized,
    legitimateDomains: r.legitimate_domains ?? [],
    plan: r.plan,
    subscriptionStatus: r.subscription_status as BrandSubscriberStatus,
    verificationStatus: r.verification_status,
    isActive: r.is_active,
    alertContactEmail: r.alert_contact_email,
    alertContactName: r.alert_contact_name,
    stripeSubscriptionId: r.stripe_subscription_id,
    activatedAt: r.activated_at,
  };
}

export function subscriberEntitlements(s: BrandSubscriber): BrandEntitlements {
  return entitlementsFor({
    plan: s.plan,
    subscriptionStatus: s.subscriptionStatus,
    verificationStatus: s.verificationStatus,
    isActive: s.isActive,
  });
}

const STATUS_RANK: Record<BrandSubscriberStatus, number> = {
  active: 0,
  lapsed: 1,
  pending: 2,
  canceled: 3,
};

/** Pure. Several orgs may subscribe to one Canonical Brand (only verified
 *  ones are entitled); prefer an entitled row, then the liveliest status,
 *  then the oldest — deterministic. */
export function pickSubscriber(
  rows: readonly BrandSubscriber[],
): BrandSubscriber | null {
  const score = (s: BrandSubscriber) =>
    subscriberEntitlements(s).brandPage ? 0 : 1;
  const sorted = [...rows].sort(
    (a, b) =>
      score(a) - score(b) ||
      STATUS_RANK[a.subscriptionStatus] - STATUS_RANK[b.subscriptionStatus] ||
      a.id - b.id,
  );
  return sorted[0] ?? null;
}

// ── Alert routing ───────────────────────────────────────────────────────────

export type BrandAlertRoute =
  | {
      kind: "subscriber";
      recipient: string;
      subscriberId: number;
      brandName: string;
    }
  | {
      kind: "directory";
      reason: "no_subscriber" | "not_entitled" | "no_contact";
    };

/**
 * Pure. The subscriber's own contact outranks brand_contact_directory (which
 * is for unsolicited outreach only, #1295 decision 4) — when the subscriber is
 * entitled to this kind of message and has a contact on file. Routing never
 * sends: every send to the subscriber passes the Brand Send Gate's
 * "subscriber" profile, which carries the #371 sign-off.
 */
export function routeBrandAlert(
  subscriber: BrandSubscriber | null,
  need: "weaponisedAlert" | "monthlyReport",
): BrandAlertRoute {
  if (!subscriber) return { kind: "directory", reason: "no_subscriber" };
  if (!subscriberEntitlements(subscriber)[need]) {
    return { kind: "directory", reason: "not_entitled" };
  }
  const recipient = subscriber.alertContactEmail?.trim();
  if (!recipient) return { kind: "directory", reason: "no_contact" };
  return {
    kind: "subscriber",
    recipient,
    subscriberId: subscriber.id,
    brandName: subscriber.brandName,
  };
}

// ── Adapters (Supabase) ─────────────────────────────────────────────────────

/**
 * The Brand Subscriber for a brand, by Canonical Brand key and/or a domain the
 * brand legitimately owns (a clone alert carries both: target_brand_normalized
 * and inferred_target_domain). Throws on a read error — callers decide whether
 * that fails the step; it must never read as "no subscriber".
 */
export async function loadBrandSubscriber(
  sb: ServiceClient,
  key: { brandNormalized?: string | null; domain?: string | null },
): Promise<{
  subscriber: BrandSubscriber | null;
  entitlements: BrandEntitlements;
}> {
  const reads: Array<
    PromiseLike<{ data: unknown; error: { message: string } | null }>
  > = [];
  if (key.brandNormalized) {
    reads.push(
      sb
        .from("monitored_brands")
        .select(SUBSCRIBER_COLUMNS)
        .eq("brand_normalized", key.brandNormalized)
        .not("subscription_status", "is", null),
    );
  }
  const domain = key.domain?.trim().toLowerCase();
  if (domain) {
    reads.push(
      sb
        .from("monitored_brands")
        .select(SUBSCRIBER_COLUMNS)
        .contains("legitimate_domains", [domain])
        .not("subscription_status", "is", null),
    );
  }
  const rows: BrandSubscriber[] = [];
  for (const res of await Promise.all(reads)) {
    if (res.error) throw new Error(`monitored_brands: ${res.error.message}`);
    for (const r of (res.data as SubscriberRow[] | null) ?? []) {
      const s = toBrandSubscriber(r);
      if (s && !rows.some((x) => x.id === s.id)) rows.push(s);
    }
  }
  const subscriber = pickSubscriber(rows);
  return {
    subscriber,
    entitlements: subscriber
      ? subscriberEntitlements(subscriber)
      : copy(NO_ENTITLEMENTS),
  };
}

/** Every Brand Subscriber of an org, with its entitlements (the logged-in
 *  brand page, #1302). Throws on a read error. */
export async function loadOrgBrandSubscribers(
  sb: ServiceClient,
  orgId: string,
): Promise<
  Array<{ subscriber: BrandSubscriber; entitlements: BrandEntitlements }>
> {
  const { data, error } = await sb
    .from("monitored_brands")
    .select(SUBSCRIBER_COLUMNS)
    .eq("org_id", orgId)
    .not("subscription_status", "is", null)
    .order("id");
  if (error) throw new Error(`monitored_brands: ${error.message}`);
  return ((data as SubscriberRow[] | null) ?? [])
    .map(toBrandSubscriber)
    .filter((s): s is BrandSubscriber => s !== null)
    .map((subscriber) => ({
      subscriber,
      entitlements: subscriberEntitlements(subscriber),
    }));
}

export type PendingOutcome = "created" | "reopened" | "already_subscribed";

/** Checkout: the pending row, created before the Stripe session (v347 RPC). */
export async function createPendingBrandSubscriber(
  sb: ServiceClient,
  args: {
    orgId: string;
    brandName: string;
    brandNormalized: string;
    primaryDomain: string;
    plan: BrandPlanKey;
    alertContactEmail: string | null;
    createdBy: string;
  },
): Promise<{ brandSubscriberId: number; outcome: PendingOutcome }> {
  const { data, error } = await sb.rpc("upsert_pending_brand_subscriber", {
    p_org_id: args.orgId,
    p_brand_name: args.brandName,
    p_brand_normalized: args.brandNormalized,
    p_primary_domain: args.primaryDomain,
    p_plan: args.plan,
    p_alert_contact_email: args.alertContactEmail,
    p_created_by: args.createdBy,
  });
  if (error)
    throw new Error(`upsert_pending_brand_subscriber: ${error.message}`);
  const row = (
    data as Array<{
      brand_subscriber_id: number;
      outcome: PendingOutcome;
    }> | null
  )?.[0];
  if (!row) throw new Error("upsert_pending_brand_subscriber returned no row");
  return {
    brandSubscriberId: Number(row.brand_subscriber_id),
    outcome: row.outcome,
  };
}

/** Webhook: apply a Stripe subscription state; returns rows matched (0 =
 *  an unmatched payment, which the caller records). */
export async function applyBrandSubscription(
  sb: ServiceClient,
  args: {
    orgId: string;
    brandSubscriberId: number | null;
    stripeSubscriptionId: string;
    plan: BrandPlanKey | null;
    billingStatus: "active" | "past_due" | "paused" | "canceled";
  },
): Promise<number> {
  const { data, error } = await sb.rpc("apply_brand_subscription", {
    p_org_id: args.orgId,
    p_brand_subscriber_id: args.brandSubscriberId,
    p_stripe_subscription_id: args.stripeSubscriptionId,
    p_plan: args.plan,
    p_billing_status: args.billingStatus,
  });
  if (error) throw new Error(`apply_brand_subscription: ${error.message}`);
  if (typeof data !== "number")
    throw new Error("apply_brand_subscription returned a non-number");
  return data;
}

export type UnmatchedReason =
  | "missing_metadata"
  | "ownership_mismatch"
  | "unknown_org"
  | "no_subscriber_row";

/** Webhook: a brand payment that could not be attached lands in the admin
 *  queue (brand_unmatched_payments, /admin/brand-outreach), not just a log. */
export async function recordUnmatchedBrandPayment(
  sb: ServiceClient,
  args: {
    stripeSubscriptionId: string;
    stripeCustomerId: string | null;
    orgId: string | null;
    brandSubscriberId: number | null;
    plan: string | null;
    billingStatus: string | null;
    reason: UnmatchedReason;
  },
): Promise<void> {
  const { error } = await sb.rpc("record_brand_unmatched_payment", {
    p_stripe_subscription_id: args.stripeSubscriptionId,
    p_stripe_customer_id: args.stripeCustomerId,
    p_org_id: args.orgId,
    p_brand_subscriber_id: args.brandSubscriberId,
    p_plan: args.plan,
    p_billing_status: args.billingStatus,
    p_reason: args.reason,
  });
  if (error)
    throw new Error(`record_brand_unmatched_payment: ${error.message}`);
}

/** A uuid-shaped org id, or null. Metadata is server-set but still untrusted
 *  input to an RPC typed uuid. */
export function parseOrgId(v: unknown): string | null {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;
}

/** A positive integer subscriber id from Stripe metadata, or null. */
export function parseSubscriberId(v: unknown): number | null {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,15}$/.test(v)) return null;
  return Number(v);
}

// ── Priority rescan worklist ────────────────────────────────────────────────

/** Rows per recheck run the priority worklist may put at the head of the
 *  urlscan cap: half of RECHECK_BATCH_LIMIT (90), so the stale-floor
 *  rotation of everyone else keeps the other half. 4 runs/day → up to 180
 *  priority rescans/day across all subscribers, inside today's spend. */
export const PRIORITY_RESCAN_PER_RUN = 45;
export const PRIORITY_RESCAN_CADENCE_HOURS = 24;

export interface PriorityRescanRow {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  lifecycle_state: string;
  last_rechecked_at: string | null;
  first_seen_at: string | null;
  recheck_dns_fingerprint: string | null;
  brand_subscriber_id: number;
  due_total: number | string | null;
}

/** Throws on a read error (the caller records it; it must not read as
 *  "no subscriber is due"). */
export async function loadPriorityRescans(
  sb: ServiceClient,
  limit = PRIORITY_RESCAN_PER_RUN,
): Promise<{ rows: PriorityRescanRow[]; dueTotal: number }> {
  const { data, error } = await sb.rpc(
    "list_brand_subscriber_priority_rescans",
    {
      p_limit: limit,
      p_cadence_hours: PRIORITY_RESCAN_CADENCE_HOURS,
    },
  );
  if (error)
    throw new Error(`list_brand_subscriber_priority_rescans: ${error.message}`);
  const rows = (data as PriorityRescanRow[] | null) ?? [];
  const due = Number(rows[0]?.due_total ?? 0);
  return { rows, dueTotal: Number.isFinite(due) ? due : 0 };
}
