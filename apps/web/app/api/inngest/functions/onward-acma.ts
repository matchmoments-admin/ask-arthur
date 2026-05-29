import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { Resend } from "resend";
import { createHash } from "node:crypto";
import { redactPII } from "@/lib/onward/redact";
import { logCost, PRICING } from "@/lib/cost-telemetry";

const ACMA_TO = "report@submit.spam.acma.gov.au";
// Reuse the existing transactional sender (matches /api/leads). Single
// brendan@askarthur.au identity for now — see onward-brand-abuse.ts.
const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Ask Arthur <brendan@askarthur.au>";
const REPLY_TO_EMAIL = "brendan@askarthur.au";

interface ScamReportRow {
  id: number;
  scam_type: string | null;
  channel: string | null;
  scrubbed_content: string | null;
  analysis_result: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Forward a scam-email submission to ACMA's spam intake. P1 ships a text
 * body only; .eml attachment forwarding (when we have the raw source) is
 * P2 once the upload path lands.
 *
 * No manual-review gate here — ACMA explicitly invites unsolicited
 * forwarding. Rate-limit kept conservative (60/hour) to look like a normal
 * forwarder, not an automated firehose.
 */
export const onwardAcmaEmailSpam = inngest.createFunction(
  {
    id: "report-onward-acma-email-spam",
    concurrency: { limit: 2 },
    timeouts: { finish: "2m" },
    name: "Onward report: ACMA spam intake",
    retries: 4,
    rateLimit: {
      limit: 60,
      period: "1h",
      key: "event.data.destination_key",
    },
  },
  { event: "report.onward.acma_email_spam" },
  async ({ event, step }) => {
    const data = event.data as {
      log_id: string;
      scam_report_id: number;
      destination_key: string;
    };

    const scamReport = await step.run("load-report", async () => {
      const sb = createServiceClient();
      if (!sb) throw new Error("Supabase service client unavailable");
      const { data: row } = await sb
        .from("scam_reports")
        .select(
          "id, scam_type, channel, scrubbed_content, analysis_result, created_at"
        )
        .eq("id", data.scam_report_id)
        .maybeSingle<ScamReportRow>();
      return row;
    });

    if (!scamReport) {
      const sb = createServiceClient()!;
      await sb
        .from("onward_report_log")
        .update({
          status: "failed",
          status_reason: "scam_report_missing",
          failed_at: new Date().toISOString(),
        })
        .eq("id", data.log_id);
      throw new Error("scam_reports row not found");
    }

    const reportRef = `ASK-${String(scamReport.id).padStart(6, "0")}`;
    const text = buildAcmaForwardBody(scamReport, reportRef);
    const payloadHash = createHash("sha256").update(text).digest("hex");

    const sendResult = await step.run("send-email", async () => {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) throw new Error("RESEND_API_KEY not configured");
      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: [ACMA_TO],
        replyTo: REPLY_TO_EMAIL,
        subject: `Spam report via Ask Arthur — ref ${reportRef}`,
        text,
      });
      if (result.error) {
        throw new Error(
          `Resend rejected: ${result.error.message ?? String(result.error)}`
        );
      }
      return result.data;
    });

    await step.run("mark-sent", async () => {
      const sb = createServiceClient()!;
      await sb
        .from("onward_report_log")
        .update({
          status: "sent",
          provider: "resend",
          provider_message_id: sendResult?.id ?? null,
          payload_hash: payloadHash,
          sent_at: new Date().toISOString(),
          attempts: 1,
        })
        .eq("id", data.log_id);
    });

    await step.run("log-cost", async () => {
      try {
        await logCost({
          feature: "onward_acma_spam",
          provider: "resend",
          operation: "acma_spam_forward",
          units: 1,
          unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
          metadata: { scam_report_id: data.scam_report_id },
        });
      } catch (err) {
        logger.error("logCost failed for ACMA forward", { error: String(err) });
      }
    });

    return { ok: true, providerMessageId: sendResult?.id };
  }
);

function buildAcmaForwardBody(
  report: ScamReportRow,
  reportRef: string
): string {
  const ar = (report.analysis_result ?? {}) as Record<string, unknown>;
  const flags = Array.isArray(ar.redFlags)
    ? (ar.redFlags as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  return [
    `Spam report forwarded via Ask Arthur (askarthur.au)`,
    `Reference: ${reportRef}`,
    `Type: ${report.scam_type ?? "unknown"}`,
    `Channel: ${report.channel ?? "unknown"}`,
    `Received: ${new Date(report.created_at).toISOString()}`,
    "",
    `Red flags identified:`,
    flags.length > 0 ? flags.map((f) => `  - ${f}`).join("\n") : "  (none extracted)",
    "",
    `Message content (PII-redacted):`,
    `---`,
    redactPII(report.scrubbed_content) || "(no content available)",
    `---`,
    "",
    `Forwarded with the reporter's consent. Reply-to is monitored at`,
    `brendan@askarthur.au for any follow-up.`,
  ].join("\n");
}
