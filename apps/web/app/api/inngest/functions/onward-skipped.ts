import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";

/**
 * Skipped-with-deeplink workers. Scamwatch / ReportCyber / IDCARE have no
 * public reporting API — we mark the log row 'skipped' with reason
 * 'no_api_user_redirect_required' and the OnwardReportSummary UI surfaces
 * a deep-link + clipboard-prefilled evidence block for the user to paste.
 *
 * Ask-Arthur-feed is a no-op marker — the actual threat-feed contribution
 * happens via the existing /api/scam-contacts/report and
 * /api/scam-urls/report routes (driven by ScamReportCard.tsx). This worker
 * only marks the audit-log row as 'sent' for the "Here's what we did"
 * panel.
 */

interface OnwardEventData {
  log_id: string;
  scam_report_id: number;
  destination_key: string;
}

async function markStatus(
  logId: string,
  status: "skipped" | "sent",
  reason: string
) {
  const sb = createServiceClient();
  if (!sb) return;
  await sb
    .from("onward_report_log")
    .update({
      status,
      status_reason: reason,
      sent_at: new Date().toISOString(),
      attempts: 1,
    })
    .eq("id", logId);
}

export const onwardScamwatch = inngest.createFunction(
  {
    id: "report-onward-scamwatch",
    concurrency: { limit: 2 },
    timeouts: { finish: "1m" },
    name: "Onward report: Scamwatch (deep-link)",
    retries: 0,
  },
  { event: "report.onward.scamwatch" },
  async ({ event, step }) => {
    const data = event.data as OnwardEventData;
    await step.run("mark-skipped", () =>
      markStatus(data.log_id, "skipped", "no_api_user_redirect_required")
    );
    return { ok: true, action: "user_redirect" };
  }
);

export const onwardReportCyber = inngest.createFunction(
  {
    id: "report-onward-reportcyber",
    name: "Onward report: ReportCyber (deep-link)",
    retries: 0,
  },
  { event: "report.onward.reportcyber" },
  async ({ event, step }) => {
    const data = event.data as OnwardEventData;
    await step.run("mark-skipped", () =>
      markStatus(data.log_id, "skipped", "no_api_user_redirect_required")
    );
    return { ok: true, action: "user_redirect" };
  }
);

export const onwardIdcare = inngest.createFunction(
  {
    id: "report-onward-idcare",
    name: "Onward report: IDCARE (phone)",
    retries: 0,
  },
  { event: "report.onward.idcare" },
  async ({ event, step }) => {
    const data = event.data as OnwardEventData;
    await step.run("mark-skipped", () =>
      markStatus(data.log_id, "skipped", "phone_handoff_user_action_required")
    );
    return { ok: true, action: "phone_handoff" };
  }
);

export const onwardAskArthurFeed = inngest.createFunction(
  {
    id: "report-onward-ask-arthur-feed",
    name: "Onward report: Ask Arthur feed (audit marker)",
    retries: 0,
  },
  { event: "report.onward.ask_arthur_feed" },
  async ({ event, step }) => {
    const data = event.data as OnwardEventData;
    // The actual feed contribution happens via /api/scam-contacts/report.
    // This worker only writes the audit-log marker for the "Here's what we
    // did" panel.
    await step.run("mark-sent", () =>
      markStatus(data.log_id, "sent", "audit_marker_only")
    );
    return { ok: true, action: "audit_marker" };
  }
);
