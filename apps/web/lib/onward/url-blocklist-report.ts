import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { Resend } from "resend";
import { createHash } from "node:crypto";
import { redactPII } from "@/lib/onward/redact";
import { logCost, PRICING } from "@/lib/cost-telemetry";

/**
 * Shared runner for "URL blocklist" onward destinations — neutral phishing/
 * malware intakes that accept unsolicited URL reports by email (OpenPhish at
 * report@openphish.com, APWG at reportphishing@apwg.org). Both forward the
 * scammer URL(s) + PII-redacted context; neither needs the brand-abuse
 * manual-review gate (these are public-interest blocklists, not brand
 * relationships). The flow mirrors onward-acma.ts; it lives here once because
 * the two workers differ only by intake address, subject, feature flag, and
 * cost label.
 *
 * Guard: if the scam report carries no scammer URL there's nothing for a URL
 * blocklist to action, so the report is marked skipped rather than sent.
 */

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

export interface UrlBlocklistOnwardConfig {
  /** Fixed neutral intake address (e.g. report@openphish.com). */
  intakeEmail: string;
  /** Human label for the subject line + body (e.g. "OpenPhish"). */
  intakeName: string;
  /** When false, the worker no-ops and marks the log row skipped. */
  featureEnabled: boolean;
  /** cost-telemetry feature label (e.g. "onward_openphish"). */
  logFeature: string;
  /** cost-telemetry operation label. */
  logOperation: string;
}

// Inngest step context — narrowed to what we use, so this module doesn't
// depend on the full Inngest type surface. Inngest's real `step.run` is an
// overloaded generic whose signature doesn't structurally satisfy this
// minimal interface, so the two thin workers pass their ctx with a localized
// `as unknown as OnwardStepCtx` cast (the runtime shapes are compatible).
export interface OnwardStepCtx {
  event: {
    data: {
      log_id: string;
      scam_report_id: number;
      destination_key: string;
    };
  };
  step: {
    run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  };
}

export async function runUrlBlocklistOnward(
  ctx: OnwardStepCtx,
  config: UrlBlocklistOnwardConfig,
): Promise<{ ok: boolean; skipped?: string; providerMessageId?: string | null }> {
  const { event, step } = ctx;
  const data = event.data;

  if (!config.featureEnabled) {
    await markLog(data.log_id, "skipped", `flag_disabled_${config.logFeature}`);
    return { ok: true, skipped: "flag_disabled" };
  }

  const scamReport = await step.run("load-report", async () => {
    const sb = createServiceClient();
    if (!sb) throw new Error("Supabase service client unavailable");
    const { data: row } = await sb
      .from("scam_reports")
      .select(
        "id, scam_type, channel, scrubbed_content, analysis_result, created_at",
      )
      .eq("id", data.scam_report_id)
      .maybeSingle<ScamReportRow>();
    return row;
  });

  if (!scamReport) {
    await markLog(data.log_id, "failed", "scam_report_missing");
    await emitOnwardError(config, data.scam_report_id, "scam_report_missing");
    throw new Error("scam_reports row not found");
  }

  const ar = (scamReport.analysis_result ?? {}) as Record<string, unknown>;
  const scammerUrls = extractStringArray(ar, ["scammerUrls", "scammer_urls"]);

  // A URL blocklist needs a URL. Nothing to action otherwise.
  if (scammerUrls.length === 0) {
    await markLog(data.log_id, "skipped", "no_scammer_url");
    return { ok: true, skipped: "no_url" };
  }

  const reportRef = `ASK-${String(scamReport.id).padStart(6, "0")}`;
  const text = buildReportBody(scamReport, scammerUrls, reportRef, config.intakeName);
  const payloadHash = createHash("sha256").update(text).digest("hex");

  let sendResult: Awaited<ReturnType<typeof sendOnward>>;
  try {
    sendResult = await step.run("send-email", () =>
      sendOnward(config.intakeEmail, reportRef, text),
    );
  } catch (err) {
    // Surface the failure to the daily health digest (the onward workers
    // otherwise fail silently — ultrareview F6). Diagnostic row, $0 cost.
    await emitOnwardError(config, data.scam_report_id, "send_failed");
    throw err;
  }

  await step.run("mark-sent", async () => {
    const sb = createServiceClient();
    if (!sb) return;
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
        feature: config.logFeature,
        provider: "resend",
        operation: config.logOperation,
        units: 1,
        unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
        metadata: {
          scam_report_id: data.scam_report_id,
          url_count: scammerUrls.length,
        },
      });
    } catch (err) {
      logger.error("logCost failed for url-blocklist onward", {
        feature: config.logFeature,
        error: String(err),
      });
    }
  });

  return { ok: true, providerMessageId: sendResult?.id };
}

async function sendOnward(
  intakeEmail: string,
  reportRef: string,
  text: string,
): Promise<{ id: string } | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  // Canary / validation mode: when ONWARD_CANARY_RECIPIENT is set, ALL onward
  // URL-blocklist reports go to that inbox (ours) instead of the real intake —
  // lets us verify the full pipeline (real status='sent' + provider_message_id)
  // without emailing OpenPhish/APWG until the format + acceptance are confirmed.
  const canary = readStringEnv("ONWARD_CANARY_RECIPIENT");
  const to = canary || intakeEmail;
  const subject = canary
    ? `[CANARY → ${intakeEmail}] Phishing URL report via Ask Arthur — ref ${reportRef}`
    : `Phishing URL report via Ask Arthur — ref ${reportRef}`;
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: [to],
    replyTo: REPLY_TO_EMAIL,
    subject,
    text,
  });
  if (result.error) {
    throw new Error(
      `Resend rejected: ${result.error.message ?? String(result.error)}`,
    );
  }
  return result.data;
}

/**
 * Emit a $0 diagnostic cost-telemetry row so onward-report failures surface in
 * the daily health digest instead of failing silently in logs only.
 * Hyphenated `onward-report-error` follows the diagnostic-tag convention
 * (cf. `reddit-intel-error`). (ultrareview F6)
 */
async function emitOnwardError(
  config: UrlBlocklistOnwardConfig,
  scamReportId: number,
  reason: string,
): Promise<void> {
  try {
    await logCost({
      feature: "onward-report-error",
      provider: "resend",
      operation: config.logOperation,
      units: 1,
      unitCostUsd: 0,
      metadata: {
        destination: config.logFeature,
        scam_report_id: scamReportId,
        reason,
      },
    });
  } catch (err) {
    logger.error("onward error telemetry failed", {
      feature: config.logFeature,
      error: String(err),
    });
  }
}

async function markLog(
  logId: string,
  status: "skipped" | "failed",
  reason: string,
): Promise<void> {
  const sb = createServiceClient();
  if (!sb) return;
  await sb
    .from("onward_report_log")
    .update({
      status,
      status_reason: reason,
      ...(status === "skipped"
        ? { sent_at: new Date().toISOString() }
        : { failed_at: new Date().toISOString() }),
    })
    .eq("id", logId);
}

function buildReportBody(
  report: ScamReportRow,
  scammerUrls: string[],
  reportRef: string,
  intakeName: string,
): string {
  return [
    `Phishing URL report forwarded via Ask Arthur (askarthur.au) to ${intakeName}.`,
    `Reference: ${reportRef}`,
    `Type: ${report.scam_type ?? "unknown"}`,
    `Channel: ${report.channel ?? "unknown"}`,
    `Received: ${new Date(report.created_at).toISOString()}`,
    "",
    `Suspected phishing URL(s):`,
    ...scammerUrls.map((u) => `  - ${stripUrlPii(u)}`),
    "",
    `Message context (PII-redacted):`,
    `---`,
    redactPII(report.scrubbed_content) || "(no content available)",
    `---`,
    "",
    `Reported in good faith for blocklist consideration. Reply-to is`,
    `monitored at brendan@askarthur.au for any follow-up.`,
  ].join("\n");
}

/**
 * Strip the query string + fragment from a reported URL before forwarding it
 * to a third-party blocklist. A captured phishing URL can carry victim PII in
 * its query params (e.g. `?email=...`, `?abn=...` prefilled on the landing
 * page); the scheme/host/path is all a blocklist needs. Falls back to a manual
 * split if the URL doesn't parse (so a malformed URL is still truncated, never
 * forwarded whole). (ultrareview F8)
 */
export function stripUrlPii(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return rawUrl.split(/[?#]/)[0];
  }
}

function extractStringArray(
  obj: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string");
    }
  }
  return [];
}
