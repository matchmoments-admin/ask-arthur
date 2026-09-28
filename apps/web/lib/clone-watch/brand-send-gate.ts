/**
 * The Brand Send Gate — ONE conjunction every Clone Watch brand send passes
 * before Resend is called (PR-C of the 2026-09-28 deepening plan).
 *
 * Before this Module the conjunction was copied into four send paths, and
 * differently each time: the stewardship route had no cost brake, the batch
 * route no unsubscribe check, auto-send no directory cross-check, and the
 * founder outreach route (which embeds real Clone Watch detections via
 * getBrandCloneSample) had none of them. Only the readiness read was shared.
 *
 * Each path now names a PROFILE — the list of checks that apply to it — so a
 * difference between paths is a visible line in BRAND_SEND_PROFILES, not a
 * missing block in a route. Adding a send path means adding a profile; the
 * scan test (__tests__/brandSendGateScan.test.ts) fails any file that sends
 * via Resend with Clone Watch brand data and never calls this gate.
 *
 * Shadow sends (to our own inbox) do not go through the gate — the callers
 * decide shadow vs real exactly as before and only a REAL send is checked.
 *
 * Fail closed: every read that errors (or returns a shape we cannot trust)
 * is a refusal with its own code, never a pass.
 */

import { createHash } from "node:crypto";
import { isFeatureBrakedOrUnknown } from "@askarthur/scam-engine/cost-log";
import { createServiceClient } from "@askarthur/supabase/server";
import { readBoolEnv } from "@askarthur/utils/env";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { readReadinessGate } from "@/lib/clone-watch/readiness-data";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

// ── The checks ──────────────────────────────────────────────────────────────

export const BRAND_SEND_CHECKS = [
  /** The path's own feature flags (outreach master, notify-brand, auto-send). */
  "flags",
  /** #371 legal sign-off of the brand-facing copy. Its only encoding today is
   *  FF_BRAND_STEWARDSHIP_SEND ("hard precondition: #371 legal sign-off"). */
  "legal_signoff",
  /** Readiness scorecard: the last READINESS_REQUIRED_MONTHS closed months
   *  ready (#1237). Missing / unreadable → refused. */
  "readiness",
  /** feature_brakes.shopfront_clone_outreach — "pauses ALL clone-watch
   *  outreach" (cost-brakes.ts). Unreadable counts as engaged. */
  "brake",
  /** Recipient opted out: brand_report_unsubscribes (one-click / in-body
   *  unsubscribe, Resend complaints) OR a STOP reply
   *  (clone_alert_recipient_is_suppressed). */
  "unsubscribe",
  /** known_brands.last_verified_at set for this brand + recipient. */
  "verified_contact",
  /** brand_contact_directory row for this brand carries this recipient on an
   *  accepted channel (security_txt / fraud_inbox). */
  "directory",
] as const;
export type BrandSendCheck = (typeof BRAND_SEND_CHECKS)[number];

/** Checks that need no recipient — a path can run these before it has loaded
 *  its target (the batch route refuses before loading the batch). */
const SEND_SCOPED: ReadonlySet<BrandSendCheck> = new Set([
  "flags",
  "legal_signoff",
  "readiness",
  "brake",
]);

type FlagName =
  | "shopfrontCloneOutreach"
  | "shopfrontCloneNotifyBrand"
  | "shopfrontCloneNotifyBrandAutoSend";

/** Refusal code per flag — the codes the routes already returned. */
const FLAG_CODES: Record<FlagName, string> = {
  shopfrontCloneOutreach: "clone_outreach_disabled",
  shopfrontCloneNotifyBrand: "clone_notify_brand_disabled",
  shopfrontCloneNotifyBrandAutoSend: "auto_send_disabled",
};

const BRAKE_FEATURE = "shopfront_clone_outreach";

export interface BrandSendProfileSpec {
  /** Evaluated in this order; a route answers with the FIRST refusal. */
  checks: readonly BrandSendCheck[];
  /** Flags for the `flags` check (all must be ON). */
  flags?: readonly FlagName[];
  /** Per-check env override (read with readBoolEnv). When set and the check
   *  refuses, the send is let through, logged always-ship and recorded in
   *  cost_telemetry; if the record cannot be written the override is NOT
   *  honoured. */
  overrides?: Partial<Record<BrandSendCheck, string>>;
  /** cost_telemetry feature for the override record. */
  auditFeature?: string;
}

/**
 * THE table. A check missing from a profile is a decision, not an accident —
 * say why beside it.
 */
export const BRAND_SEND_PROFILES = {
  /** Monthly Brand Stewardship Report, REAL recipient
   *  (api/admin/brand-stewardship/[id]/send). No `flags`: the only flag on this
   *  path is the #371 sign-off. No `directory`: stewardship recipients come
   *  from known_brands, which `verified_contact` checks instead. */
  "stewardship-real": {
    checks: ["legal_signoff", "readiness", "brake", "unsubscribe", "verified_contact"],
  },
  /** Admin-approved brand-notify batch (api/admin/clone-watch/batches/[batchId]/send).
   *  `legal_signoff` added 2026-09-28 (PR-C review): real brand contact of any
   *  kind needs the #371 sign-off — the founder's no-contact rule.
   *  No `verified_contact`: the directory cross-check is its recipient check. */
  batch: {
    checks: ["flags", "legal_signoff", "readiness", "brake", "directory", "unsubscribe"],
    flags: ["shopfrontCloneOutreach", "shopfrontCloneNotifyBrand"],
  },
  /** notify-brand-prepare auto-send. Same as `batch` plus the auto-send flag:
   *  an auto-sent batch must pass everything a human-approved one does. */
  "auto-send": {
    checks: ["flags", "legal_signoff", "readiness", "brake", "directory", "unsubscribe"],
    flags: [
      "shopfrontCloneOutreach",
      "shopfrontCloneNotifyBrand",
      "shopfrontCloneNotifyBrandAutoSend",
    ],
  },
  /** Founder-composed outreach (api/admin/brand-outreach/send). Founder
   *  decision 2026-09-28: gated on readiness because it embeds real Clone
   *  Watch detections (getBrandCloneSample); the escape hatch is an explicit,
   *  logged env override (readiness ONLY — it never overrides an opt-out).
   *  `unsubscribe` added 2026-09-28 (PR-C review): the outreach email's
   *  unsubscribe link now points at /api/brand-stewardship/unsubscribe, which
   *  writes brand_report_unsubscribes — the store this check reads. (The old
   *  link went to the consumer /unsubscribe page, whose RPC only UPDATEs an
   *  existing email_subscribers row, so for a brand contact it recorded
   *  nothing.) No `legal_signoff`, `brake`, `directory` or `verified_contact`:
   *  a person wrote and approved the email to an address they chose. */
  outreach: {
    checks: ["readiness", "unsubscribe"],
    overrides: { readiness: "BRAND_OUTREACH_READINESS_OVERRIDE" },
    auditFeature: "brand_outreach",
  },
} as const satisfies Record<string, BrandSendProfileSpec>;

export type BrandSendProfile = keyof typeof BRAND_SEND_PROFILES;

// ── Result ──────────────────────────────────────────────────────────────────

export interface BrandSendRefusal {
  check: BrandSendCheck | "recipient";
  /** Stable machine code — the `error` a route returns. */
  code: string;
  detail?: string;
}

export interface BrandSendDecision {
  allowed: boolean;
  /** Refusals in profile order. Empty when allowed. */
  reasons: BrandSendRefusal[];
  /** Refusals an env override let through (only when allowed). */
  overridden?: BrandSendRefusal[];
}

export interface BrandSendTarget {
  recipient: string | null | undefined;
  /** brand_contact_directory.brand (the `directory` check). */
  brand?: string | null;
  /** known_brands.brand_key (the `verified_contact` check). */
  brandKey?: string | null;
  /** Free-form context for the override record (no PII). */
  context?: Record<string, unknown>;
}

/** HTTP status per refusal code — ONE home, so the routes answer the same
 *  refusal the same way (codes and statuses are the ones they returned). */
export const REFUSAL_STATUS: Record<string, number> = {
  send_disabled: 403,
  clone_outreach_disabled: 503,
  clone_notify_brand_disabled: 503,
  auto_send_disabled: 503,
  not_ready: 403,
  cost_brake_engaged: 503,
  no_recipient: 422,
  recipient_unsubscribed: 409,
  recipient_suppressed: 409,
  unsubscribe_unreadable: 503,
  contact_unverified: 403,
  contact_unreadable: 503,
  directory_lookup_failed: 500,
  directory_row_missing: 409,
  recipient_mismatch: 409,
  override_unrecorded: 503,
  gate_error: 503,
};

export function refusalStatus(r: BrandSendRefusal): number {
  return REFUSAL_STATUS[r.code] ?? 503;
}

// ── The gate ────────────────────────────────────────────────────────────────

export interface BrandSendGate {
  readonly profile: BrandSendProfile;
  /** Only the checks that need no recipient (flags, sign-off, readiness,
   *  brake). Memoised: `check()` reuses it. */
  preflight(): Promise<BrandSendDecision>;
  /** Every check in the profile for one recipient. */
  check(target: BrandSendTarget): Promise<BrandSendDecision>;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

function specOf(profile: BrandSendProfile): BrandSendProfileSpec {
  return BRAND_SEND_PROFILES[profile];
}

/**
 * One gate per request / run. Send-scoped reads (readiness, brake) happen once
 * per instance, however many recipients are checked — auto-send checks up to
 * MAX_GROUPS_PER_RUN recipients with a single readiness + brake read.
 */
export function createBrandSendGate(
  profile: BrandSendProfile,
  sb: ServiceClient | null,
  now: Date = new Date(),
): BrandSendGate {
  const spec = specOf(profile);
  let preflightMemo: Promise<BrandSendRefusal[]> | null = null;

  const runPreflight = () => {
    preflightMemo ??= sendScopedRefusals(spec, sb, now);
    return preflightMemo;
  };

  return {
    profile,
    async preflight() {
      return settle(profile, spec, sb, await runPreflight(), undefined);
    },
    async check(target) {
      const refusals = [...(await runPreflight())];
      refusals.push(...(await recipientRefusals(spec, sb, target)));
      return settle(profile, spec, sb, refusals, target);
    },
  };
}

/** One-shot form for a path that checks a single recipient. */
export async function checkBrandSend(
  profile: BrandSendProfile,
  sb: ServiceClient | null,
  target: BrandSendTarget,
  now: Date = new Date(),
): Promise<BrandSendDecision> {
  return createBrandSendGate(profile, sb, now).check(target);
}

async function sendScopedRefusals(
  spec: BrandSendProfileSpec,
  sb: ServiceClient | null,
  now: Date,
): Promise<BrandSendRefusal[]> {
  const out: BrandSendRefusal[] = [];
  for (const check of spec.checks) {
    if (!SEND_SCOPED.has(check)) continue;
    try {
      out.push(...(await runSendCheck(check, spec, sb, now)));
    } catch (err) {
      out.push({ check, code: "gate_error", detail: String(err) });
    }
  }
  return out;
}

async function runSendCheck(
  check: BrandSendCheck,
  spec: BrandSendProfileSpec,
  sb: ServiceClient | null,
  now: Date,
): Promise<BrandSendRefusal[]> {
  switch (check) {
    case "flags":
      return (spec.flags ?? [])
        .filter((f) => featureFlags[f] !== true)
        .map((f) => ({ check, code: FLAG_CODES[f] }));
    case "legal_signoff":
      return featureFlags.brandStewardshipSend === true
        ? []
        : [
            {
              check,
              code: "send_disabled",
              detail: "FF_BRAND_STEWARDSHIP_SEND is OFF (pending #371 legal sign-off)",
            },
          ];
    case "readiness": {
      const g = await readReadinessGate(sb, now);
      return g.ready
        ? []
        : [
            {
              check,
              code: "not_ready",
              detail: `Clone Watch readiness scorecard is not ready for ${g.months.join(", ")} (${g.reason}). No brand is contacted until it is — see /admin/clone-watch.`,
            },
          ];
    }
    case "brake":
      // Outbound email → fail closed: an unreadable brake refuses the send.
      return (await isFeatureBrakedOrUnknown(BRAKE_FEATURE))
        ? [{ check, code: "cost_brake_engaged", detail: `feature_brakes.${BRAKE_FEATURE}` }]
        : [];
    default:
      return [];
  }
}

async function recipientRefusals(
  spec: BrandSendProfileSpec,
  sb: ServiceClient | null,
  target: BrandSendTarget,
): Promise<BrandSendRefusal[]> {
  const checks = spec.checks.filter((c) => !SEND_SCOPED.has(c));
  if (checks.length === 0) return [];
  const recipient = (target.recipient ?? "").trim();
  if (!recipient) return [{ check: "recipient", code: "no_recipient" }];

  const out: BrandSendRefusal[] = [];
  for (const check of checks) {
    try {
      if (!sb) throw new Error("service client unavailable");
      out.push(...(await runRecipientCheck(check, sb, recipient, target)));
    } catch (err) {
      out.push({ check, code: UNREADABLE_CODE[check] ?? "gate_error", detail: String(err) });
    }
  }
  return out;
}

const UNREADABLE_CODE: Partial<Record<BrandSendCheck, string>> = {
  unsubscribe: "unsubscribe_unreadable",
  verified_contact: "contact_unreadable",
  directory: "directory_lookup_failed",
};

async function runRecipientCheck(
  check: BrandSendCheck,
  sb: ServiceClient,
  recipient: string,
  target: BrandSendTarget,
): Promise<BrandSendRefusal[]> {
  switch (check) {
    case "unsubscribe": {
      const { data: unsub, error } = await sb
        .from("brand_report_unsubscribes")
        .select("email")
        .eq("email", recipient.toLowerCase())
        .maybeSingle();
      if (error) throw new Error(`brand_report_unsubscribes: ${error.message}`);
      if (unsub) return [{ check, code: "recipient_unsubscribed" }];
      const { data: stop, error: stopErr } = await sb.rpc(
        "clone_alert_recipient_is_suppressed",
        { p_email: recipient },
      );
      if (stopErr) throw new Error(`clone_alert_recipient_is_suppressed: ${stopErr.message}`);
      // A boolean function answers a boolean; anything else is not an answer.
      if (typeof stop !== "boolean") throw new Error("suppression check returned a non-boolean");
      return stop ? [{ check, code: "recipient_suppressed" }] : [];
    }
    case "verified_contact": {
      if (!target.brandKey) {
        return [{ check, code: "contact_unverified", detail: "no brand_key to verify against" }];
      }
      const { data: kb, error } = await sb
        .from("known_brands")
        .select("last_verified_at")
        .eq("brand_key", target.brandKey)
        .eq("security_contact_email", recipient)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw new Error(`known_brands: ${error.message}`);
      return kb?.last_verified_at
        ? []
        : [
            {
              check,
              code: "contact_unverified",
              detail:
                "Recipient contact is not verified (known_brands.last_verified_at is null). Verify the real security contact before sending to the brand.",
            },
          ];
    }
    case "directory": {
      if (!target.brand) return [{ check, code: "directory_row_missing", detail: "no brand" }];
      const { data: rows, error } = await sb
        .from("brand_contact_directory")
        .select("recipient, channel_type")
        .eq("brand", target.brand)
        .limit(1);
      if (error) throw new Error(`brand_contact_directory: ${error.message}`);
      const row = (rows as Array<{ recipient: string; channel_type: string }> | null)?.[0];
      if (!row) return [{ check, code: "directory_row_missing" }];
      if (
        row.recipient !== recipient ||
        (row.channel_type !== "security_txt" && row.channel_type !== "fraud_inbox")
      ) {
        return [
          {
            check,
            code: "recipient_mismatch",
            detail: `recipient ${hash(recipient)} vs directory ${hash(row.recipient ?? "")} (${row.channel_type})`,
          },
        ];
      }
      return [];
    }
    default:
      return [];
  }
}

/** Apply the profile's overrides, then decide. */
async function settle(
  profile: BrandSendProfile,
  spec: BrandSendProfileSpec,
  sb: ServiceClient | null,
  refusals: BrandSendRefusal[],
  target: BrandSendTarget | undefined,
): Promise<BrandSendDecision> {
  const overridable = (r: BrandSendRefusal) => {
    const env = r.check !== "recipient" ? spec.overrides?.[r.check] : undefined;
    return env ? readBoolEnv(env) : false;
  };
  const kept = refusals.filter((r) => !overridable(r));
  const overridden = refusals.filter(overridable);
  if (kept.length > 0) return { allowed: false, reasons: kept };
  if (overridden.length === 0) return { allowed: true, reasons: [] };
  // preflight() never lets an override through — only a full check() of a
  // real send, which is what the record describes.
  if (!target) return { allowed: false, reasons: overridden };

  const recorded = await recordOverride(profile, spec, sb, overridden, target);
  if (!recorded) {
    return {
      allowed: false,
      reasons: [
        {
          check: overridden[0].check,
          code: "override_unrecorded",
          detail: "the override record could not be written, so the override is not honoured",
        },
      ],
    };
  }
  return { allowed: true, reasons: [], overridden };
}

/**
 * The override's audit trail: an always-ship warn (Axiom) AND a durable
 * cost_telemetry row ($0, `operation = '<check>_override'`). Written directly
 * and awaited — logCostAsync swallows a failed insert, and an override nobody
 * can see afterwards is exactly what this record exists to prevent.
 */
async function recordOverride(
  profile: BrandSendProfile,
  spec: BrandSendProfileSpec,
  sb: ServiceClient | null,
  overridden: BrandSendRefusal[],
  target: BrandSendTarget,
): Promise<boolean> {
  const metadata = {
    profile,
    overridden: overridden.map((r) => ({ check: r.check, code: r.code, detail: r.detail })),
    env: overridden.map((r) => (r.check !== "recipient" ? spec.overrides?.[r.check] : null)),
    recipient_hash: hash((target.recipient ?? "").toLowerCase()),
    brand_key: target.brandKey ?? null,
    ...(target.context ?? {}),
  };
  logger.warn("brand_send_gate_override", metadata);
  if (!sb) return false;
  try {
    const { error } = await sb.from("cost_telemetry").insert({
      feature: spec.auditFeature ?? "brand_send_gate",
      provider: "internal",
      operation: `${overridden[0].check}_override`,
      units: 1,
      unit_cost_usd: 0,
      estimated_cost_usd: 0,
      metadata,
    });
    if (error) {
      logger.warn("brand_send_gate_override_unrecorded", { profile, error: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("brand_send_gate_override_unrecorded", { profile, error: String(err) });
    return false;
  }
}
