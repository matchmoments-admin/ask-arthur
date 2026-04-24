import "server-only";

// Alert dispatch — email + optional org webhook.
//
// Called from the phone-footprint-refresh-monitor Inngest function once
// a delta crosses the monitor's alert_threshold. Mutates
// phone_footprint_alerts.delivered_channels + delivered_at to record
// what shipped. Failures in one channel don't block the other.
//
// Email goes via Resend (already wired for the PDF email path).
// Webhook is fleet-only — pulls fleet_webhook_url + fleet_webhook_secret
// from the org row, signs the payload with HMAC-SHA256, fires-and-checks
// for 2xx. No retries here; Inngest's retries handle the whole step.

import { createHmac } from "node:crypto";
import { Resend } from "resend";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import type {
  Footprint,
  FootprintDelta,
} from "@askarthur/scam-engine/phone-footprint";

interface MonitorForAlert {
  id: number;
  user_id: string | null;
  org_id: string | null;
  msisdn_e164: string;
}

export async function dispatchAlert(args: {
  alertId: number;
  monitor: MonitorForAlert;
  footprint: Footprint;
  delta: FootprintDelta;
}): Promise<void> {
  const channelsSent: string[] = [];

  // ── Email
  try {
    const ok = await sendAlertEmail(args);
    if (ok) channelsSent.push("email");
  } catch (err) {
    logger.warn("alert email failed", { error: String(err), alertId: args.alertId });
  }

  // ── Org webhook (fleet only)
  if (args.monitor.org_id) {
    try {
      const ok = await sendAlertWebhook(args);
      if (ok) channelsSent.push("webhook");
    } catch (err) {
      logger.warn("alert webhook failed", { error: String(err), alertId: args.alertId });
    }
  }

  // Update the alert row with delivery state — even an empty
  // channels_sent is useful (says "we tried, nothing worked"), so we
  // always write it.
  const supa = createServiceClient();
  if (!supa) return;
  await supa
    .from("phone_footprint_alerts")
    .update({
      delivered_at: new Date().toISOString(),
      delivered_channels: channelsSent,
    })
    .eq("id", args.alertId);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function sendAlertEmail(args: {
  alertId: number;
  monitor: MonitorForAlert;
  footprint: Footprint;
  delta: FootprintDelta;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    logger.warn("alert email skipped — RESEND envs missing");
    return false;
  }

  const supa = createServiceClient();
  if (!supa) return false;

  // Pull recipient from user_profiles.billing_email (preferred — what the
  // user listed for invoices; usually the right inbox for monitoring
  // alerts) or from auth.users.email as fallback.
  let recipient: string | null = null;
  if (args.monitor.user_id) {
    const { data } = await supa
      .from("user_profiles")
      .select("billing_email")
      .eq("id", args.monitor.user_id)
      .maybeSingle();
    recipient = (data?.billing_email as string | null) ?? null;
    if (!recipient) {
      // Fallback to auth.users.email — readable via service role.
      const { data: u } = await supa.auth.admin.getUserById(args.monitor.user_id);
      recipient = u.user?.email ?? null;
    }
  }
  if (!recipient) return false;

  const subject = subjectFor(args.delta, args.footprint, args.monitor);
  const html = emailBody(args);

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: fromEmail,
    to: recipient,
    subject,
    html,
  });

  logCost({
    feature: "phone_footprint",
    provider: "resend",
    operation: "alert_email",
    units: 1,
    unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
    metadata: {
      alertId: args.alertId,
      monitorId: args.monitor.id,
      alertType: args.delta.type,
    },
    userId: args.monitor.user_id,
  });

  return true;
}

function subjectFor(
  delta: FootprintDelta,
  footprint: Footprint,
  monitor: MonitorForAlert,
): string {
  const last4 = monitor.msisdn_e164.slice(-4);
  switch (delta.type) {
    case "sim_swap":
      return `[Critical] SIM swap detected on number ending ${last4}`;
    case "new_breach":
      return `[Critical] New breach exposure for number ending ${last4}`;
    case "band_change":
      return `Phone Footprint changed: ${footprint.band.toUpperCase()} (number ending ${last4})`;
    case "new_scam_reports":
      return `New scam reports linked to number ending ${last4}`;
    case "carrier_change":
      return `Carrier changed for number ending ${last4}`;
    case "fraud_score_delta":
      return `Live fraud score moved for number ending ${last4}`;
    case "score_delta":
      return `Phone Footprint score updated for number ending ${last4}`;
  }
}

function emailBody(args: {
  alertId: number;
  monitor: MonitorForAlert;
  footprint: Footprint;
  delta: FootprintDelta;
}): string {
  const detailLines = Object.entries(args.delta.detail)
    .map(([k, v]) => `<li><strong>${k}:</strong> ${escapeHtml(JSON.stringify(v))}</li>`)
    .join("");
  return `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, sans-serif; color: #0F172A; max-width: 600px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 18px; margin-bottom: 4px;">Phone Footprint alert</h1>
    <p style="color: #64748B; margin-top: 0;">${args.monitor.msisdn_e164}</p>
    <p style="margin-top: 24px;">
      <strong>${humanType(args.delta.type)}</strong>
      <span style="background: ${severityBg(args.delta.severity)}; color: ${severityFg(args.delta.severity)}; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-left: 8px;">
        ${args.delta.severity}
      </span>
    </p>
    <p>Current composite score: <strong>${args.footprint.composite_score}/100</strong> (${args.footprint.band}).</p>
    <ul style="background: #F8FAFC; padding: 12px 24px; border-radius: 8px;">
      ${detailLines}
    </ul>
    <p style="color: #64748B; font-size: 12px; margin-top: 32px;">
      Ask Arthur · askarthur.au · Manage your monitors at /app/phone-footprint/monitors
    </p>
  </body>
</html>`;
}

function humanType(t: FootprintDelta["type"]): string {
  switch (t) {
    case "sim_swap": return "SIM swap detected";
    case "new_breach": return "New breach exposure";
    case "band_change": return "Risk band changed";
    case "new_scam_reports": return "New scam reports";
    case "carrier_change": return "Carrier change";
    case "fraud_score_delta": return "Fraud score moved";
    case "score_delta": return "Composite score changed";
  }
}

function severityFg(sev: FootprintDelta["severity"]): string {
  return sev === "critical" ? "#B91C1C" : sev === "warning" ? "#B45309" : "#1D4ED8";
}
function severityBg(sev: FootprintDelta["severity"]): string {
  return sev === "critical" ? "#FEF2F2" : sev === "warning" ? "#FFF8E1" : "#EFF6FF";
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Webhook (fleet only)
// ---------------------------------------------------------------------------
//
// Payload shape — versioned; downstream consumers should pin v=1:
//   {
//     v: 1,
//     event: "phone-footprint.alert.v1",
//     alert_id, monitor_id, org_id, msisdn_e164, alert_type, severity,
//     detail, composite_score, band, generated_at
//   }
//
// Signature header: x-askarthur-signature: t={epochSec},v1={hex}
// where v1 = HMAC-SHA256(secret, `${epochSec}.${rawBody}`).
// Mirrors Stripe's signature scheme so consumers can adapt their existing
// signature-verification middleware with one constant change.

async function sendAlertWebhook(args: {
  alertId: number;
  monitor: MonitorForAlert;
  footprint: Footprint;
  delta: FootprintDelta;
}): Promise<boolean> {
  if (!args.monitor.org_id) return false;
  const supa = createServiceClient();
  if (!supa) return false;

  const { data: org } = await supa
    .from("organizations")
    .select("fleet_webhook_url, fleet_webhook_secret")
    .eq("id", args.monitor.org_id)
    .maybeSingle();
  if (!org?.fleet_webhook_url || !org.fleet_webhook_secret) return false;

  const payload = JSON.stringify({
    v: 1,
    event: "phone-footprint.alert.v1",
    alert_id: args.alertId,
    monitor_id: args.monitor.id,
    org_id: args.monitor.org_id,
    msisdn_e164: args.monitor.msisdn_e164,
    alert_type: args.delta.type,
    severity: args.delta.severity,
    detail: args.delta.detail,
    composite_score: args.footprint.composite_score,
    band: args.footprint.band,
    generated_at: args.footprint.generated_at,
  });

  const epoch = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", org.fleet_webhook_secret)
    .update(`${epoch}.${payload}`)
    .digest("hex");
  const signatureHeader = `t=${epoch},v1=${sig}`;

  const res = await fetch(org.fleet_webhook_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-askarthur-signature": signatureHeader,
      "x-askarthur-event": "phone-footprint.alert.v1",
    },
    body: payload,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    logger.warn("alert webhook non-2xx", {
      orgId: args.monitor.org_id,
      status: res.status,
      alertId: args.alertId,
    });
    return false;
  }
  return true;
}
