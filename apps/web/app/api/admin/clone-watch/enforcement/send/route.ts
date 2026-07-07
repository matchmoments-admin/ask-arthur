import { NextResponse } from "next/server";
import { z } from "zod";

import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

import { requireAdmin } from "@/lib/adminAuth";
import { logEnforcementEvent } from "@/lib/clone-watch/enforcement-telemetry";
import { sendOnward, stripUrlPii } from "@/lib/onward/url-blocklist-report";

/**
 * Admin approve + send for a HUMAN-GATED enforcement channel (registrar / host
 * abuse) — the itch.io-safe path: a domain-level abuse report only ever goes out
 * when a human explicitly clicks send AND confirms (four-eyes). Reuses the
 * sendOnward email primitive (canary-safe via ONWARD_CANARY_RECIPIENT) and the
 * SAME shared daily cap as the auto path. Never touches an 'auto' or
 * 'brand_routed' case — only registrar_abuse / hosting_abuse.
 */

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  caseId: z.number().int().positive(),
  confirm: z.literal(true), // four-eyes: the operator must explicitly confirm
});

const DEFAULT_DAILY_CAP = 50;

const INTAKE_FROM_ATTRIBUTION: Record<
  string,
  (attr: Attribution) => string | null | undefined
> = {
  registrar_abuse: (a) => a?.registrar_abuse_email,
  hosting_abuse: (a) => a?.hosting?.abuse_email,
};

interface Attribution {
  registrar?: string | null;
  registrar_abuse_email?: string | null;
  hosting?: { provider?: string | null; abuse_email?: string | null } | null;
}

export async function POST(req: Request) {
  await requireAdmin();

  if (!featureFlags.cloneEnforcement) {
    return NextResponse.json({ error: "enforcement_disabled" }, { status: 503 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { caseId } = parsed.data;

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Load the case + its alert.
  const { data: caseRow } = await sb
    .from("shopfront_takedown_attempts")
    .select("id, clone_alert_id, attempt_type, channel_autonomy, case_status")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) {
    return NextResponse.json({ error: "case_not_found" }, { status: 404 });
  }
  if (caseRow.channel_autonomy !== "human_required") {
    return NextResponse.json({ error: "not_human_gated" }, { status: 422 });
  }
  const resolveIntake = INTAKE_FROM_ATTRIBUTION[caseRow.attempt_type];
  if (!resolveIntake) {
    // GSB/SmartScreen are form-only deep-links, not emailable from here.
    return NextResponse.json({ error: "channel_not_emailable" }, { status: 422 });
  }
  if (caseRow.case_status !== "queued" && caseRow.case_status !== "pending_approval") {
    return NextResponse.json({ error: "case_not_open" }, { status: 409 });
  }

  const { data: alert } = await sb
    .from("shopfront_clone_alerts")
    .select("candidate_url, candidate_domain, target_brand_normalized, attribution")
    .eq("id", caseRow.clone_alert_id)
    .maybeSingle();
  if (!alert) {
    return NextResponse.json({ error: "alert_not_found" }, { status: 404 });
  }

  const intake = resolveIntake(alert.attribution as Attribution);
  if (!intake) {
    return NextResponse.json({ error: "no_abuse_recipient" }, { status: 422 });
  }

  // Shared daily cap — same guard as the auto path.
  const { data: usedRaw } = await sb.rpc("count_todays_takedown_submissions");
  const used = typeof usedRaw === "number" ? usedRaw : 0;
  const cap = Number.parseInt(process.env.CLONE_SUBMISSION_DAILY_CAP ?? "", 10);
  const dailyCap = Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_DAILY_CAP;
  if (used >= dailyCap) {
    return NextResponse.json({ error: "daily_cap_reached" }, { status: 429 });
  }

  // Claim BEFORE sending (queued→submitted) so a retry can't double-send.
  const claim = await sb.rpc("merge_takedown_case", {
    p_alert_id: caseRow.clone_alert_id,
    p_channel: caseRow.attempt_type,
    p_autonomy: "human_required",
    p_acts_on_parked: false,
    p_status: "submitted",
    p_evidence: { intake, approved_by: "admin_panel" },
    p_external_ref: null,
    p_next_action_at: null,
  });
  if (claim.error) {
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }

  const brand = alert.target_brand_normalized ?? "an Australian brand";
  const safeUrl = stripUrlPii(alert.candidate_url);
  const text = [
    `Evidenced phishing / DNS-abuse report from Ask Arthur (askarthur.au):`,
    ``,
    `URL: ${safeUrl}`,
    `Domain: ${alert.candidate_domain}`,
    `Impersonated brand: ${brand}`,
    ``,
    `This domain is a lookalike of ${brand}, independently classified as likely`,
    `phishing by our automated scan. Please action per your abuse process.`,
    `Reply to this email to dispute.`,
  ].join("\n");

  try {
    const result = await sendOnward(intake, `clone-${caseId}`, text);
    await sb.rpc("merge_takedown_case", {
      p_alert_id: caseRow.clone_alert_id,
      p_channel: caseRow.attempt_type,
      p_autonomy: "human_required",
      p_acts_on_parked: false,
      p_status: "submitted",
      p_evidence: {},
      p_external_ref: result?.id ?? null,
      p_next_action_at: null,
    });
    logEnforcementEvent("reported", {
      alertId: caseRow.clone_alert_id,
      caseId,
      domain: alert.candidate_domain,
      brand: alert.target_brand_normalized,
      channel: caseRow.attempt_type,
      autonomy: "human_required",
      extra: { intake, approved_by: "admin_panel" },
    });
    return NextResponse.json({ ok: true, provider_message_id: result?.id ?? null });
  } catch (err) {
    // Send failed after claim → revert to queued for a clean manual retry.
    try {
      await sb.rpc("merge_takedown_case", {
        p_alert_id: caseRow.clone_alert_id,
        p_channel: caseRow.attempt_type,
        p_autonomy: "human_required",
        p_acts_on_parked: false,
        p_status: "queued",
        p_evidence: {},
        p_external_ref: null,
        p_next_action_at: null,
      });
    } catch {
      /* leave submitted; visible in the admin tab for manual retry */
    }
    logger.warn("clone enforcement admin send failed", {
      caseId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
}
