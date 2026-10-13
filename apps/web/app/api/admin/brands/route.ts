// Pilot-brand onboarding (#953): create the first monitored_brands row from
// the console instead of hand-written SQL.
//
// This is Engine 2's conversion moment — five pilot emails went out 2026-08-08,
// and monitored_brands was still empty (0 rows). Onboarding a paying brand by
// typing INSERT statements is how you get a typo'd brand_normalized that
// silently matches nothing.
//
// Deliberate constraints, all inherited from v207's own schema rather than
// invented here: verification_status starts 'pending' (the matcher index only
// covers verified+active, so a new row can't silently go live unverified);
// brand_normalized comes from canonicalBrandKey() — the one Canonical Brand
// derivation (alias-resolve, then brandNormalize) checkout also uses (#1295).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { canonicalBrandKey } from "@/lib/clone-watch/canonical-brand-key";
import { logger } from "@askarthur/utils/logger";
import { seedKnownBrandForSubscriber } from "@/lib/clone-watch/known-brand-seed";
import { SCORED_BRAND_CATEGORIES } from "@/lib/clone-watch/weaponisation-risk";

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** v256's reserved "brands Arthur watches on its own evidence" org. Brands with
 *  no paying customer belong here — NOT in Ask Arthur's operational org, which
 *  is what an arbitrary organizations[0] pick produced. */
export const HOUSE_ORG_ID = "00000000-0000-4000-8000-000000000001";

const Body = z.object({
  orgId: z.string().uuid(),
  brandName: z.string().trim().min(2).max(120),
  /** Domains the brand legitimately owns — the exclusion list the matcher uses
   *  so a brand's OWN sites never surface as lookalikes of itself. */
  legitimateDomains: z.array(z.string().trim().toLowerCase()).min(1).max(20),
  // ≥5 chars per au-brand-watchlist.ts: a short alias becomes a false-positive
  // engine once it enters the NRD lexical sweep.
  aliases: z.array(z.string().trim().min(5)).max(20).optional(),
  plan: z.enum(["brand_pilot", "brand_monitor", "brand_monitor_plus", "brand_enterprise"]),
  verificationMethod: z.enum(["dns_txt", "email_domain", "manual"]).optional(),
  /** #1295: the Brand Subscriber's own alert contact (weaponised alerts +
   *  monthly report). Ignored for the house org, which never subscribes. */
  alertContactEmail: z.string().trim().toLowerCase().email().max(254).optional(),
  /** #1304: the brand's category for the weaponisation-risk score, written to
   *  its known_brands row on activation. Ignored for the house org. */
  brandCategory: z.enum(SCORED_BRAND_CATEGORIES).optional(),
});

export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const {
    orgId,
    brandName,
    legitimateDomains,
    aliases,
    plan,
    verificationMethod,
    alertContactEmail,
    brandCategory,
  } = parsed.data;
  const isHouse = orgId === HOUSE_ORG_ID;

  const bad = legitimateDomains.filter((d) => !DOMAIN.test(d));
  if (bad.length > 0) {
    return NextResponse.json({ error: "invalid_domain", detail: bad.join(", ") }, { status: 400 });
  }

  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });

  // The join key — the SAME Canonical Brand derivation checkout uses
  // (ADR-0020, #1295), so an operator-onboarded brand and a bought one are
  // one row. A name that normalises to null would match nothing forever.
  const brandNormalized = await canonicalBrandKey(sb, brandName);
  if (!brandNormalized) {
    return NextResponse.json({ error: "brand_name_not_normalisable" }, { status: 400 });
  }

  // A customer org must actually have members, or the v207 RLS read policy
  // (membership via org_members) means the customer can never see the brand we
  // just onboarded for them — it would be visible only to us. The house org is
  // exempt by design: it has no members and isn't meant to.
  if (!isHouse) {
    const { count: memberCount } = await sb
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", orgId);
    if (!memberCount) {
      return NextResponse.json(
        {
          error: "org_has_no_members",
          detail:
            "That org has no members, so its users could never read this brand (v207 RLS). Use the house org for brands with no customer yet.",
        },
        { status: 400 },
      );
    }
  }

  const { data, error } = await sb
    .from("monitored_brands")
    .insert({
      org_id: orgId,
      brand_name: brandName,
      brand_normalized: brandNormalized,
      legitimate_domains: legitimateDomains,
      aliases: aliases ?? [],
      plan,
      // #1295: a customer org's row is a Brand Subscriber — onboarded here by
      // hand (the A$300 pilot is manually billed), so it is active at once;
      // its entitlements still wait for verification (brand-subscriber.ts).
      // A house-org row is a watch row, never a subscriber (v347 CHECK).
      subscription_status: isHouse ? null : "active",
      billing_provider: isHouse ? null : "manual",
      activated_at: isHouse ? null : new Date().toISOString(),
      alert_contact_email: isHouse ? null : (alertContactEmail ?? null),
      verification_method: verificationMethod ?? "manual",
      // Left at the schema default ('pending') ON PURPOSE: the matcher's
      // partial index only covers verified+active rows, so nothing goes live
      // until someone verifies it. Onboarding must not be able to skip that.
      created_by: await getAdminUserId(),
    })
    .select("id, brand_name, brand_normalized, verification_status, plan, subscription_status")
    .maybeSingle();

  if (error) {
    // 23505 = the UNIQUE (org_id, brand_normalized) guard doing its job.
    const duplicate = error.code === "23505";
    logger.warn("monitored_brand_create_failed", {
      brandNormalized,
      duplicate,
      error: error.message,
    });
    return NextResponse.json(
      { error: duplicate ? "already_monitored" : "insert_failed", detail: error.message },
      { status: duplicate ? 409 : 500 },
    );
  }

  // warn: onboarding a brand is a rare, high-value commercial event.
  logger.warn("monitored_brand_created", {
    id: data?.id,
    brandNormalized,
    plan,
    domains: legitimateDomains.length,
  });
  // #1304: a customer-org row is an active Brand Subscriber from here, so it
  // gets its known_brands row now (category + a security.txt probe) — not when
  // it is verified onto the overlay. House rows reach known_brands through the
  // discover roster once verified.
  const knownBrand =
    !isHouse && data?.id
      ? await seedKnownBrandForSubscriber(sb, {
          brandSubscriberId: Number(data.id),
          brandName,
          brandCategory: brandCategory ?? null,
        })
      : null;

  return NextResponse.json({ ok: true, brand: data, knownBrand });
}
