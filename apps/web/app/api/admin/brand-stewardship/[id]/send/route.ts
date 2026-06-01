import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { render } from "@react-email/components";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import BrandStewardshipReport from "@/emails/BrandStewardshipReport";

export const dynamic = "force-dynamic";

interface StewardshipMetrics {
  detected?: number;
  reported_by_destination?: Record<string, number>;
  reports_sent?: number;
}

function periodLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  return d.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * POST /api/admin/brand-stewardship/[id]/send — send the monthly summary email
 * for a prepared row.
 *
 * Recipient routing (the validation-first design):
 *   • If BRAND_STEWARDSHIP_SHADOW_RECIPIENT is set → ALL sends go to that inbox
 *     (e.g. ours), regardless of the brand's real contact. This is the
 *     first-month "see it work" path: sending to ourselves carries no
 *     defamation/legal risk, so it does NOT require the #371 sign-off gate.
 *   • Otherwise → the real brand contact (recipient_email), gated by
 *     FF_BRAND_STEWARDSHIP_SEND (default OFF; #371 legal sign-off of the
 *     outreach copy is the precondition to flip it).
 *
 * Idempotent: refuses if the row is already 'sent', and passes a stable Resend
 * idempotencyKey so a retry never double-sends. On Resend failure the row is
 * marked 'failed' with the reason for the admin to retry.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await params;

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const { data: row, error } = await sb
    .from("brand_stewardship_reports")
    .select(
      "id, brand_key, brand_name, period_month, metrics, recipient_email, status",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.status === "sent") {
    return NextResponse.json(
      { error: "already_sent" },
      { status: 409 },
    );
  }

  // Resolve recipient + decide whether the #371 send gate applies.
  const shadow = readStringEnv("BRAND_STEWARDSHIP_SHADOW_RECIPIENT");
  const isShadow = Boolean(shadow);
  const recipient = isShadow ? shadow! : row.recipient_email;

  if (!isShadow) {
    if (!featureFlags.brandStewardshipSend) {
      return NextResponse.json(
        { error: "send_disabled", detail: "FF_BRAND_STEWARDSHIP_SEND is OFF (pending #371 legal sign-off)" },
        { status: 403 },
      );
    }
    if (!recipient) {
      return NextResponse.json(
        { error: "no_recipient" },
        { status: 422 },
      );
    }
  }

  const fromEmail = readStringEnv("RESEND_FROM_EMAIL");
  const apiKey = process.env.RESEND_API_KEY;
  if (!fromEmail || !apiKey) {
    logger.error("brand-stewardship send: RESEND env unset", {
      hasFrom: Boolean(fromEmail),
      hasKey: Boolean(apiKey),
    });
    return NextResponse.json({ error: "email_not_configured" }, { status: 503 });
  }

  const metrics = (row.metrics ?? {}) as StewardshipMetrics;
  const period = String(row.period_month).slice(0, 10);
  const label = periodLabel(period);

  const html = await render(
    BrandStewardshipReport({
      brandName: row.brand_name as string,
      periodLabel: label,
      detected: metrics.detected ?? 0,
      reportedByDestination: metrics.reported_by_destination ?? {},
      reportsSent: metrics.reports_sent ?? 0,
      reportRef: `BSR-${row.brand_key}-${period.slice(0, 7)}`,
    }),
  );

  let messageId: string | null = null;
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send(
      {
        from: fromEmail,
        to: [recipient as string],
        subject: `${row.brand_name} brand-protection summary — ${label}`,
        html,
      },
      { idempotencyKey: `bsr-send:${id}` },
    );
    if (result.error) {
      throw new Error(result.error.message ?? String(result.error));
    }
    messageId = result.data?.id ?? null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("brand-stewardship send: Resend rejected", { id, reason });
    await sb
      .from("brand_stewardship_reports")
      .update({ status: "failed", status_reason: `resend_error: ${reason.slice(0, 200)}` })
      .eq("id", id);
    return NextResponse.json({ error: "send_failed", detail: reason }, { status: 502 });
  }

  const { error: updErr } = await sb
    .from("brand_stewardship_reports")
    .update({
      status: "sent",
      provider: "resend",
      provider_message_id: messageId,
      sent_at: new Date().toISOString(),
      approved_by_admin_id: "hmac_admin",
      status_reason: isShadow
        ? `shadow_send:${recipient} (intended ${row.recipient_email ?? "—"})`
        : null,
    })
    .eq("id", id)
    .neq("status", "sent");
  if (updErr) {
    // Email already left; surface the ledger-write failure so the admin knows
    // the row state may be stale (the Resend idempotencyKey blocks a re-send).
    logger.error("brand-stewardship send: ledger update failed post-send", {
      id,
      error: updErr.message,
    });
  }

  logCost({
    feature: "brand_stewardship",
    provider: "resend",
    operation: "monthly_summary",
    units: 1,
    unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
  });

  return NextResponse.json({
    ok: true,
    status: "sent",
    mode: isShadow ? "shadow" : "real",
    recipient,
    provider_message_id: messageId,
  });
}
