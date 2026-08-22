import "server-only";

// Document-check monthly allowance resolver — the ONE place the B2B routes
// ask "how many document checks does this organisation get?".
//
// Precedence:
// 1. An org-level doc-plan entitlement (organizations.settings.document_billing
//    — written by the Stripe webhook, or by the founder with
//    billing_provider='manual' for pilots) with status active/past_due
//    (past_due = the dunning-grace semantics brand billing established).
// 2. Fallback: TIER_LIMITS[apiKeyTier].documentChecksPerMonth — the interim
//    tier mapping (pro 200 / business 1,500) keeps working for keys that
//    predate doc plans, and for local/dev.
//
// Deliberately NEVER api_keys.tier as a write target — doc plans are a
// separate SKU axis (see documentSkus.ts header for the price-arbitrage and
// key-vs-org scope reasons).

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { TIER_LIMITS } from "@askarthur/types";
import { DOCUMENT_PLANS, type DocumentPlanKey } from "@/lib/documentSkus";

export interface DocumentAllowance {
  monthlyLimit: number;
  /** Where the allowance came from — displayed in /api/v1/usage. */
  source: "document_plan" | "tier";
  plan: DocumentPlanKey | null;
}

interface DocumentBillingRecord {
  plan?: string;
  status?: string;
  billing_provider?: string;
}

/** Resolve the org's monthly document-check allowance. `apiKeyTier` is the
 *  calling key's tier (the fallback axis). Lookup failure degrades to the
 *  tier fallback with an error-level log — a Supabase blip must not zero a
 *  paying customer's allowance. */
export async function documentAllowanceForOrg(
  orgId: string,
  apiKeyTier: string | undefined,
): Promise<DocumentAllowance> {
  const tierLimit =
    TIER_LIMITS[(apiKeyTier ?? "free") as keyof typeof TIER_LIMITS]
      ?.documentChecksPerMonth ?? 0;
  const fallback: DocumentAllowance = {
    monthlyLimit: tierLimit,
    source: "tier",
    plan: null,
  };

  const supabase = createServiceClient();
  if (!supabase) return fallback;

  try {
    const { data: org, error } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    if (error) {
      logger.error("documentAllowanceForOrg: org lookup failed", {
        error: error.message,
        orgId,
      });
      return fallback;
    }
    const billing = (org?.settings as Record<string, unknown> | null)
      ?.document_billing as DocumentBillingRecord | undefined;
    if (!billing?.plan) return fallback;
    if (billing.status !== "active" && billing.status !== "past_due") {
      return fallback;
    }
    const plan = billing.plan as DocumentPlanKey;
    const planDef = DOCUMENT_PLANS[plan];
    if (!planDef) {
      logger.warn("documentAllowanceForOrg: unknown plan in document_billing", {
        orgId,
        plan: billing.plan,
      });
      return fallback;
    }
    return {
      monthlyLimit: planDef.documentChecksPerMonth,
      source: "document_plan",
      plan,
    };
  } catch (err) {
    logger.error("documentAllowanceForOrg: unexpected error", {
      error: String(err),
      orgId,
    });
    return fallback;
  }
}
