// POST /api/phone-footprint/[id]/pdf
//
// Enqueues an Inngest event that renders the footprint to PDF, uploads
// to R2, and emails a signed download URL to the caller. Returns
// immediately with 202 Accepted — the email is the completion signal.
//
// Gated by:
//   1. NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER (whole surface)
//   2. authenticated user (no anon PDFs — prevents drive-by spend on
//      R2 storage + email delivery)
//   3. footprint must belong to the caller (user_id match) OR caller
//      must be org member if the footprint is org-scoped
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
import { getUser } from "@/lib/auth";
import { PHONE_FOOTPRINT_PDF_EVENT } from "@/app/api/inngest/functions/phone-footprint-pdf";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const footprintId = Number.parseInt(id, 10);
  if (!Number.isInteger(footprintId) || footprintId <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
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

  // Ownership gate — the caller must own the footprint (user_id match)
  // OR be a member of the org that owns it. We fetch the row via service
  // role and enforce the check in-code so we can return 404 for both
  // "not found" and "not yours" (don't leak existence).
  const { data: fp, error: fpErr } = await supa
    .from("phone_footprints")
    .select("id, user_id, org_id, tier_generated, msisdn_e164")
    .eq("id", footprintId)
    .maybeSingle();

  if (fpErr) {
    logger.error("pdf route: footprint lookup failed", { error: String(fpErr.message) });
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!fp) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (fp.tier_generated === "teaser") {
    // No value in a PDF of a teaser view — it's a summary card. Reject
    // with a clear error so the UI can nudge the user to upgrade.
    return NextResponse.json({ error: "teaser_not_exportable" }, { status: 403 });
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
      footprintId,
      userId: user.id,
      recipientEmail: user.email,
      requestId: req.headers.get("x-request-id"),
    },
  });

  return NextResponse.json(
    { accepted: true, footprintId, message: "PDF will arrive via email shortly." },
    { status: 202 },
  );
}
