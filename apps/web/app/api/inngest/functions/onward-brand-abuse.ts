import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { Resend } from "resend";
import { render } from "@react-email/components";
import { createHash } from "node:crypto";
import BrandAbuseReport from "@/emails/BrandAbuseReport";
import { redactPII } from "@/lib/onward/redact";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { resolveEmailCopy } from "@/lib/email/resolve-copy";

/**
 * Manual-review gate threshold. The first N successful sends to any given
 * brand_key are held in 'manual_review' status — admin must approve via
 * /admin/onward-reports before they go out. This protects brand
 * relationships during the false-positive shake-out window.
 */
const MANUAL_REVIEW_THRESHOLD = 10;

// Reuse the existing transactional sender (matches /api/leads). Single
// brendan@askarthur.au identity for now — keeps SPF/DKIM/DMARC setup to
// one domain alignment until the volume justifies a dedicated reports@
// subdomain. Per founder direction 2026-05-08.
const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Ask Arthur <brendan@askarthur.au>";
const REPLY_TO_EMAIL = "brendan@askarthur.au";

interface BrandRow {
  id: number;
  brand_name: string;
  brand_key: string | null;
  security_contact_email: string | null;
  contact_type: string | null;
  is_active: boolean;
}

interface ScamReportRow {
  id: number;
  scam_type: string | null;
  channel: string | null;
  impersonated_brand: string | null;
  scrubbed_content: string | null;
  analysis_result: Record<string, unknown> | null;
  created_at: string;
}

export const onwardBrandAbuse = inngest.createFunction(
  {
    id: "report-onward-brand-abuse",
    concurrency: { limit: 2 },
    timeouts: { finish: "2m" },
    name: "Onward report: Brand abuse email",
    retries: 4,
    rateLimit: {
      limit: 5,
      period: "24h",
      key: "event.data.destination_key",
    },
  },
  { event: "report.onward.brand_abuse" },
  withAxiomLogging({ fnId: "report-onward-brand-abuse" }, async ({ event, step }) => {
    const data = event.data as {
      log_id: string;
      scam_report_id: number;
      destination_key: string;
      analysis_id: string | null;
      /** Set true when an admin re-fires this event from /admin/onward-reports
       *  after approving a manual_review row. Bypasses the threshold gate so
       *  the email actually goes out. The first-N audit count itself isn't
       *  reset — once approved, the row contributes to the threshold like a
       *  natural send. */
      bypassManualReview?: boolean;
    };

    // Load brand contact + log row + scam_reports row in parallel.
    const [brand, scamReport] = await step.run("load-rows", async () => {
      const sb = createServiceClient()!;
      const [brandRes, reportRes] = await Promise.all([
        sb
          .from("known_brands")
          .select(
            "id, brand_name, brand_key, security_contact_email, contact_type, is_active"
          )
          .eq("brand_key", data.destination_key)
          .maybeSingle<BrandRow>(),
        sb
          .from("scam_reports")
          .select(
            "id, scam_type, channel, impersonated_brand, scrubbed_content, analysis_result, created_at"
          )
          .eq("id", data.scam_report_id)
          .maybeSingle<ScamReportRow>(),
      ]);
      return [brandRes.data, reportRes.data] as const;
    });

    if (!brand) {
      await markLog(data.log_id, "skipped", "unknown_brand_key");
      return { ok: true, skipped: "unknown_brand" };
    }

    if (!brand.is_active) {
      await markLog(data.log_id, "skipped", "brand_inactive");
      return { ok: true, skipped: "brand_inactive" };
    }

    if (brand.contact_type !== "email" || !brand.security_contact_email) {
      await markLog(
        data.log_id,
        "skipped",
        "contact_not_email_user_action_required"
      );
      return { ok: true, skipped: "not_email_contact" };
    }

    if (!scamReport) {
      await markLog(data.log_id, "failed", "scam_report_missing");
      throw new Error("scam_reports row not found for log " + data.log_id);
    }

    // Manual-review gate: first N successful sends to this brand require
    // admin approval. We count distinct prior 'sent' rows for the same
    // destination + destination_key. An admin can bypass via the
    // /admin/onward-reports approve action, which re-fires this event
    // with bypassManualReview=true.
    const sentSoFar = await step.run("count-prior-sends", async () => {
      const sb = createServiceClient()!;
      const { count } = await sb
        .from("onward_report_log")
        .select("id", { head: true, count: "exact" })
        .eq("destination", "brand_abuse")
        .eq("destination_key", data.destination_key)
        .eq("status", "sent");
      return count ?? 0;
    });

    if (!data.bypassManualReview && sentSoFar < MANUAL_REVIEW_THRESHOLD) {
      await markLog(
        data.log_id,
        "manual_review",
        `held_pending_admin_approval_${sentSoFar}_of_${MANUAL_REVIEW_THRESHOLD}`
      );
      await step.run("notify-admin-manual-review", async () => {
        try {
          await sendAdminTelegramMessage(
            [
              `/agent-fleet onward-review`,
              `<b>Brand-abuse send held for review</b>`,
              `Brand: ${escapeHtml(brand.brand_name)}`,
              `Sent so far: ${sentSoFar}/${MANUAL_REVIEW_THRESHOLD}`,
              `Scam report: <code>${data.scam_report_id}</code>`,
              `Approve via /admin/onward-reports`,
            ].join("\n")
          );
        } catch (err) {
          logger.error("manual_review admin notify failed", {
            error: String(err),
          });
        }
      });
      return { ok: true, manual_review: true, sentSoFar };
    }

    // Build the email body
    const reportRef = `ASK-${String(scamReport.id).padStart(6, "0")}`;
    const ar = (scamReport.analysis_result ?? {}) as Record<string, unknown>;
    const redFlags = Array.isArray(ar.redFlags)
      ? (ar.redFlags as unknown[]).filter((s): s is string => typeof s === "string")
      : Array.isArray(ar.red_flags)
        ? (ar.red_flags as unknown[]).filter(
            (s): s is string => typeof s === "string"
          )
        : [];
    const scammerUrls = extractStringArray(ar, ["scammerUrls", "scammer_urls"]);
    const scammerPhones = extractStringArray(ar, [
      "scammerPhones",
      "scammer_phones",
    ]);
    const scammerEmails = extractStringArray(ar, [
      "scammerEmails",
      "scammer_emails",
    ]);

    const copy = await step.run("resolve-copy", () =>
      resolveEmailCopy("brand_abuse"),
    );
    const html = await step.run("render-email", () =>
      render(
        BrandAbuseReport({
          brandName: brand.brand_name,
          scamType: scamReport.scam_type ?? "unknown",
          channel: scamReport.channel ?? "unknown",
          scammerUrls,
          scammerPhones,
          scammerEmails,
          redactedContent: redactPII(scamReport.scrubbed_content),
          redFlags,
          receivedAt: new Date(scamReport.created_at).toISOString(),
          reportRef,
          copy,
        })
      )
    );

    const payloadHash = createHash("sha256")
      .update(brand.security_contact_email + "|" + reportRef + "|" + html)
      .digest("hex");

    // Send via Resend
    const sendResult = await step.run("send-email", async () => {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) throw new Error("RESEND_API_KEY not configured");
      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: [brand.security_contact_email!],
        replyTo: REPLY_TO_EMAIL,
        subject: `Phishing / scam impersonating ${brand.brand_name} — Ask Arthur ref ${reportRef}`,
        html,
      });
      if (result.error) {
        throw new Error(
          `Resend rejected: ${result.error.message ?? String(result.error)}`
        );
      }
      return result.data;
    });

    // Update log + brand_impersonation_alerts
    await step.run("mark-sent", async () => {
      const sb = createServiceClient()!;
      const now = new Date().toISOString();
      await sb
        .from("onward_report_log")
        .update({
          status: "sent",
          provider: "resend",
          provider_message_id: sendResult?.id ?? null,
          payload_hash: payloadHash,
          sent_at: now,
          attempts: 1,
        })
        .eq("id", data.log_id);
      // Light up brand_impersonation_alerts (v49 scaffold). Best-effort —
      // if no row exists for this scam_report we don't fail.
      await sb
        .from("brand_impersonation_alerts")
        .update({
          outreach_status: "sent",
          outreach_contact: brand.security_contact_email,
          outreach_sent_at: now,
        })
        .eq("brand_name", brand.brand_name)
        .eq("scam_content_hash", payloadHash.slice(0, 64));
    });

    await step.run("log-cost", async () => {
      try {
        await logCost({
          feature: "onward_brand_abuse",
          provider: "resend",
          operation: "brand_abuse_email",
          units: 1,
          unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
          metadata: {
            brand_key: brand.brand_key,
            scam_report_id: data.scam_report_id,
          },
        });
      } catch (err) {
        logger.error("logCost failed for brand abuse", { error: String(err) });
      }
    });

    return { ok: true, sent: true, providerMessageId: sendResult?.id };
  })
);

async function markLog(
  logId: string,
  status: "skipped" | "failed" | "manual_review",
  reason: string
) {
  const sb = createServiceClient();
  if (!sb) return;
  await sb
    .from("onward_report_log")
    .update({
      status,
      status_reason: reason,
      ...(status === "skipped" || status === "manual_review"
        ? { sent_at: new Date().toISOString() }
        : { failed_at: new Date().toISOString() }),
    })
    .eq("id", logId);
}

function extractStringArray(
  obj: Record<string, unknown>,
  keys: string[]
): string[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string");
    }
  }
  return [];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
