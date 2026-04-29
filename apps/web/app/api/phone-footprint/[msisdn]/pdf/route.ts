// POST /api/phone-footprint/[msisdn]/pdf
//
// Enqueues an Inngest event that renders the most recent FULL footprint
// for this msisdn (owned by the caller) to PDF, uploads to R2, and emails
// a signed download URL. Returns 202 immediately — email is the
// completion signal.
//
// The msisdn segment matches the parent GET route's slug name. Next.js
// requires sibling dynamic segments at the same path level to share a
// param name, which is also why this is keyed by msisdn rather than the
// numeric phone_footprints.id used internally by the Inngest worker.
//
// Gated by:
//   1. NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER (whole surface)
//   2. authenticated user (no anon PDFs — prevents drive-by spend on
//      R2 storage + email delivery)
//   3. footprint must belong to the caller (user_id match) OR caller
//      must be an active member of the org that owns it
//   4. pf_pdf_render rate limit (5/day per user)
//
// Does NOT render the PDF inline. PDF rendering takes 200-800ms and
// uses ~50MB of Node RSS; pinning that in a Vercel function slot for
// every request is wasteful. The Inngest function has a generous
// concurrency cap and retries separately.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkPhoneFootprintRateLimit } from "@askarthur/utils/rate-limit";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { normalizePhoneE164 } from "@askarthur/scam-engine/phone-footprint";
import { getUser } from "@/lib/auth";
import { PHONE_FOOTPRINT_PDF_EVENT } from "@/app/api/inngest/functions/phone-footprint-pdf";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ msisdn: string }> },
) {
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { msisdn: rawMsisdn } = await params;
  const msisdn = normalizePhoneE164(decodeURIComponent(rawMsisdn));
  if (!msisdn) {
    return NextResponse.json({ error: "invalid_msisdn" }, { status: 400 });
  }

  // Rate limit per-user BEFORE touching the DB — the bucket is the cost
  // ceiling on R2 + Resend and Supabase reads are cheaper than getting
  // this wrong.
  const rl = await checkPhoneFootprintRateLimit("pdf_render", user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retry_after: rl.resetAt?.toISOString() ?? null },
      { status: 429 },
    );
  }

  const supa = createServiceClient();
  if (!supa) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 500 });
  }

  // Resolve the most recent FULL-tier snapshot for this msisdn that is
  // either user-owned or owned by an org the caller is an active member
  // of. We fetch via service role and enforce ownership in code so 404
  // covers both "not found" and "not yours" (don't leak existence).
  const { data: fp, error: fpErr } = await supa
    .from("phone_footprints")
    .select("id, user_id, org_id, tier_generated, msisdn_e164")
    .eq("msisdn_e164", msisdn)
    .eq("tier_generated", "full")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fpErr) {
    logger.error("pdf route: footprint lookup failed", { error: String(fpErr.message) });
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!fp) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (fp.msisdn_e164 === "REDACTED") {
    return NextResponse.json({ error: "footprint_anonymised" }, { status: 410 });
  }

  const ownsDirectly = fp.user_id === user.id;
  let ownsViaOrg = false;
  if (!ownsDirectly && fp.org_id) {
    const { data: member } = await supa
      .from("org_members")
      .select("user_id")
      .eq("org_id", fp.org_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    ownsViaOrg = !!member;
  }
  if (!ownsDirectly && !ownsViaOrg) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Enqueue — Inngest function handles render + R2 upload + email.
  await inngest.send({
    name: PHONE_FOOTPRINT_PDF_EVENT,
    data: {
      footprintId: fp.id,
      userId: user.id,
      recipientEmail: user.email,
      requestId: req.headers.get("x-request-id"),
    },
  });

  return NextResponse.json(
    { accepted: true, footprintId: fp.id, message: "PDF will arrive via email shortly." },
    { status: 202 },
  );
}
