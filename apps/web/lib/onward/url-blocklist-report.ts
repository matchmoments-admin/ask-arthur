import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { Resend } from "resend";
import { createHash } from "node:crypto";
import { redactPII } from "@/lib/onward/redact";
import { logCost, PRICING } from "@/lib/cost-telemetry";

/**
 * Shared runner for "URL blocklist" onward destinations — neutral phishing/
 * malware intakes that accept unsolicited URL reports by email (OpenPhish,
 * APWG; the addresses live in lib/onward/destinations.ts). Both forward the
 * reported URL(s) + PII-redacted context; neither needs the brand-abuse
 * manual-review gate (these are public-interest blocklists, not brand
 * relationships). The flow mirrors onward-acma.ts; it lives here once because
 * the two workers differ only by intake address, subject, feature flag, and
 * cost label.
 *
 * One ledger, two subjects (v318, ADR-0018 amendment 2026-09-23): a row is
 * either a scam report (source='scam_report') or a clone-watch lookalike
 * (source='clone_alert', produced by shopfront-clone-enforcement-execute).
 * Both producers enqueue through {@link enqueueUrlBlocklistReports} — the
 * per-URL dedup across sources lives in its RPC — and both are sent by the
 * SAME report.onward.<destination> worker below, so the canary reroute, the
 * query-string strip, the worker throttle and the error telemetry apply to
 * every send without a second copy.
 *
 * Guard: if the subject carries no URL there's nothing for a URL blocklist to
 * action, so the row is marked skipped rather than sent.
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

/** A clone-watch lookalike subject (source='clone_alert'). */
interface CloneAlertSubjectRow {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  target_brand_normalized: string | null;
  lifecycle_state: string | null;
}

export interface UrlBlocklistOnwardConfig {
  /** Fixed neutral intake address (from lib/onward/destinations.ts). */
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

/** The report.onward.<destination> event payload — one per ledger row. */
export interface UrlBlocklistOnwardEventData {
  log_id: string;
  /** Set for source='scam_report' rows; null for a clone subject. */
  scam_report_id: number | null;
  /** Set for source='clone_alert' rows (v318). Absent on pre-v318 events. */
  clone_alert_id?: number | null;
  destination_key: string;
  analysis_id?: string | null;
}

// Inngest step context — narrowed to what we use, so this module doesn't
// depend on the full Inngest type surface. Inngest's real `step.run` is an
// overloaded generic whose signature doesn't structurally satisfy this
// minimal interface, so the two thin workers pass their ctx with a localized
// `as unknown as OnwardStepCtx` cast (the runtime shapes are compatible).
export interface OnwardStepCtx {
  event: {
    data: UrlBlocklistOnwardEventData;
  };
  step: {
    run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  };
}

type OnwardOutcome = {
  ok: boolean;
  skipped?: string;
  providerMessageId?: string | null;
};

/** What a ledger row reports — carried into telemetry metadata. */
type OnwardSubjectRef = { scam_report_id: number } | { clone_alert_id: number };

export async function runUrlBlocklistOnward(
  ctx: OnwardStepCtx,
  config: UrlBlocklistOnwardConfig,
): Promise<OnwardOutcome> {
  const { event, step } = ctx;
  const data = event.data;

  if (!config.featureEnabled) {
    await markLog(data.log_id, "skipped", `flag_disabled_${config.logFeature}`);
    return { ok: true, skipped: "flag_disabled" };
  }

  if (data.clone_alert_id != null) {
    return runCloneSubject(ctx, config, data.clone_alert_id);
  }
  if (data.scam_report_id == null) {
    await markLog(data.log_id, "failed", "no_subject");
    throw new Error("onward event carries neither scam_report_id nor clone_alert_id");
  }
  const scamReportId = data.scam_report_id;

  const scamReport = await step.run("load-report", async () => {
    const sb = createServiceClient();
    if (!sb) throw new Error("Supabase service client unavailable");
    const { data: row } = await sb
      .from("scam_reports")
      .select(
        "id, scam_type, channel, scrubbed_content, analysis_result, created_at",
      )
      .eq("id", scamReportId)
      .maybeSingle<ScamReportRow>();
    return row;
  });

  if (!scamReport) {
    await markLog(data.log_id, "failed", "scam_report_missing");
    await emitOnwardError(config, { scam_report_id: scamReportId }, "scam_report_missing");
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
  return sendAndRecord(ctx, config, {
    reportRef,
    text: buildReportBody(scamReport, scammerUrls, reportRef, config.intakeName),
    subject: { scam_report_id: scamReportId },
    urlCount: scammerUrls.length,
  });
}

async function runCloneSubject(
  ctx: OnwardStepCtx,
  config: UrlBlocklistOnwardConfig,
  cloneAlertId: number,
): Promise<OnwardOutcome> {
  const { event, step } = ctx;
  const logId = event.data.log_id;

  const alert = await step.run("load-clone-alert", async () => {
    const sb = createServiceClient();
    if (!sb) throw new Error("Supabase service client unavailable");
    const { data: row } = await sb
      .from("shopfront_clone_alerts")
      .select(
        "id, candidate_url, candidate_domain, target_brand_normalized, lifecycle_state",
      )
      .eq("id", cloneAlertId)
      .maybeSingle<CloneAlertSubjectRow>();
    return row;
  });

  // The FP purge (v152) can delete an alert between enqueue and send. There is
  // nothing left to report — a skip, not a failure that retries forever.
  if (!alert) {
    await markLog(logId, "skipped", "clone_alert_missing");
    return { ok: true, skipped: "clone_alert_missing" };
  }
  // Re-verify at send time: only a lookalike our scanner still holds as
  // weaponised goes to a blocklist. One taken down / gone dormant between
  // enqueue and send is skipped — the itch.io false-takedown guard, applied at
  // the last moment rather than only when the worklist was read.
  if (alert.lifecycle_state !== "weaponised") {
    await markLog(
      logId,
      "skipped",
      `clone_not_weaponised:${alert.lifecycle_state ?? "unknown"}`,
    );
    return { ok: true, skipped: "clone_not_weaponised" };
  }

  const reportRef = `clone-${alert.id}`;
  return sendAndRecord(ctx, config, {
    reportRef,
    text: buildCloneReportBody(alert, reportRef, config.intakeName),
    subject: { clone_alert_id: alert.id },
    urlCount: 1,
  });
}

/** Send one rendered report and record it on its ledger row — both subjects. */
async function sendAndRecord(
  ctx: OnwardStepCtx,
  config: UrlBlocklistOnwardConfig,
  report: {
    reportRef: string;
    text: string;
    subject: OnwardSubjectRef;
    urlCount: number;
  },
): Promise<OnwardOutcome> {
  const { event, step } = ctx;
  const logId = event.data.log_id;
  const { reportRef, text, subject } = report;
  const payloadHash = createHash("sha256").update(text).digest("hex");

  let sendResult: Awaited<ReturnType<typeof sendOnward>>;
  try {
    sendResult = await step.run("send-email", () =>
      sendOnward(config.intakeEmail, reportRef, text),
    );
  } catch (err) {
    // Surface the failure to the daily health digest (the onward workers
    // otherwise fail silently — ultrareview F6). Diagnostic row, $0 cost.
    await emitOnwardError(config, subject, "send_failed");
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
      .eq("id", logId);
  });

  await step.run("log-cost", async () => {
    try {
      await logCost({
        feature: config.logFeature,
        provider: "resend",
        operation: config.logOperation,
        units: 1,
        unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
        metadata: { ...subject, url_count: report.urlCount },
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

/**
 * Low-level phishing-URL report email primitive, reused by the admin
 * clone-enforcement send route (registrar / hosting abuse). Honours
 * ONWARD_CANARY_RECIPIENT: when set, every report is routed to that inbox
 * (ours) instead of the real intake — the itch.io-safe way to validate the
 * pipeline end-to-end before any report actually reaches APWG / OpenPhish.
 * Throws on Resend rejection.
 */
export async function sendOnward(
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

// ── The ONE enqueue path (v318 enqueue_onward_url_reports) ──────────────────

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

interface UrlReportTarget {
  destination: string;
  destination_key: string;
  /** The raw reported URL. The RPC derives url_key (public.onward_url_key)
   *  from it — TypeScript never computes the dedup key, so it cannot drift from
   *  the clone worklist's exclusion predicate, which calls the same function. */
  url: string;
}

export type UrlReportRequest =
  | ({ source: "scam_report"; scam_report_id: number } & UrlReportTarget)
  | ({ source: "clone_alert"; clone_alert_id: number } & UrlReportTarget);

export interface EnqueuedUrlReport {
  id: string;
  source: "scam_report" | "clone_alert";
  scam_report_id: number | null;
  clone_alert_id: number | null;
  destination: string;
  destination_key: string;
  url_key: string;
}

/**
 * Insert queued onward_report_log rows for URL-blocklist destinations and
 * return ONLY the rows actually inserted. A row whose (destination,
 * destination_key, url_key) was already reported — from either source — or
 * whose (scam_report_id, destination, destination_key) exists is dropped by
 * the RPC's ON CONFLICT DO NOTHING, so the caller fires exactly one worker
 * event per genuinely new report (ADR-0018 F9). Throws on an RPC error so the
 * calling step retries visibly instead of reporting "0 enqueued".
 */
export async function enqueueUrlBlocklistReports(
  sb: ServiceClient,
  rows: UrlReportRequest[],
): Promise<EnqueuedUrlReport[]> {
  if (rows.length === 0) return [];
  const { data, error } = await sb.rpc("enqueue_onward_url_reports", {
    p_rows: rows,
  });
  if (error) {
    throw new Error(`enqueue_onward_url_reports failed: ${error.message}`);
  }
  return (data as EnqueuedUrlReport[] | null) ?? [];
}

/** The report.onward.<destination> event for each freshly-enqueued row. */
export function onwardEventsFor(
  rows: EnqueuedUrlReport[],
): Array<{ name: string; data: UrlBlocklistOnwardEventData }> {
  return rows.map((r) => ({
    name: `report.onward.${r.destination}`,
    data: {
      log_id: r.id,
      scam_report_id: r.scam_report_id,
      clone_alert_id: r.clone_alert_id,
      destination_key: r.destination_key,
      analysis_id: null,
    },
  }));
}

/**
 * Emit a $0 diagnostic cost-telemetry row so onward-report failures surface in
 * the daily health digest instead of failing silently in logs only.
 * Hyphenated `onward-report-error` follows the diagnostic-tag convention
 * (cf. `reddit-intel-error`). (ultrareview F6)
 */
async function emitOnwardError(
  config: UrlBlocklistOnwardConfig,
  subject: OnwardSubjectRef,
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
        ...subject,
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
 * The report body for a clone-watch lookalike (moved here from
 * clone-watch-enforcement-execute so both subjects render in one Module).
 * The URL is query/fragment-stripped (F8) — a captured clone URL can carry
 * victim identifiers in its params.
 */
export function buildCloneReportBody(
  alert: Pick<CloneAlertSubjectRow, "candidate_url" | "target_brand_normalized">,
  reportRef: string,
  intakeName: string,
): string {
  const brand = alert.target_brand_normalized ?? "an Australian brand";
  return [
    `Suspected phishing / brand-impersonation URL reported by Ask Arthur (askarthur.au) to ${intakeName}.`,
    `Reference: ${reportRef}`,
    ``,
    `URL: ${stripUrlPii(alert.candidate_url)}`,
    `Impersonated brand: ${brand}`,
    ``,
    `This domain was detected as a lookalike of ${brand} and independently`,
    `classified as likely phishing by our automated scan. Please verify and`,
    `action per your process. Reply to this email to dispute.`,
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
