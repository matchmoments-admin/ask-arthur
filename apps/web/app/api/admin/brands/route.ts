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
// brand_normalized comes from the CANONICAL brandNormalize() shared with the
// SQL function and the seed generator, never a local re-implementation.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { brandNormalize } from "@askarthur/shopfront-glue";
import { logger } from "@askarthur/utils/logger";

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
  const { orgId, brandName, legitimateDomains, aliases, plan, verificationMethod } = parsed.data;

  const bad = legitimateDomains.filter((d) => !DOMAIN.test(d));
  if (bad.length > 0) {
    return NextResponse.json({ error: "invalid_domain", detail: bad.join(", ") }, { status: 400 });
  }

  // The join key. A brand whose name normalises to null (symbols only) would
  // match nothing forever — reject rather than create a dead row.
  const brandNormalized = brandNormalize(brandName);
  if (!brandNormalized) {
    return NextResponse.json({ error: "brand_name_not_normalisable" }, { status: 400 });
  }

  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });

  // A customer org must actually have members, or the v207 RLS read policy
  // (membership via org_members) means the customer can never see the brand we
  // just onboarded for them — it would be visible only to us. The house org is
  // exempt by design: it has no members and isn't meant to.
  if (orgId !== HOUSE_ORG_ID) {
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
      verification_method: verificationMethod ?? "manual",
      // Left at the schema default ('pending') ON PURPOSE: the matcher's
      // partial index only covers verified+active rows, so nothing goes live
      // until someone verifies it. Onboarding must not be able to skip that.
      created_by: await getAdminUserId(),
    })
    .select("id, brand_name, brand_normalized, verification_status, plan")
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
  return NextResponse.json({ ok: true, brand: data });
}
