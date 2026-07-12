import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";

/**
 * Deep-link / audit marker workers (consolidated 2026-07-12 fleet review).
 *
 * Scamwatch / ReportCyber / IDCARE have no public reporting API — we mark the
 * log row 'skipped' with a reason and the OnwardReportSummary UI surfaces a
 * deep-link + clipboard-prefilled evidence block for the user to paste.
 * Ask-Arthur-feed is a no-op 'sent' marker — the actual threat-feed
 * contribution happens via /api/scam-contacts/report + /api/scam-urls/report
 * (driven by ScamReportCard.tsx); this only writes the audit-log marker for
 * the "Here's what we did" panel.
 *
 * These four were four near-identical single-fn registrations that all called
 * the same markStatus() helper, differing ONLY in the literal (status, reason,
 * action) triple. They write no external API, no cost, and share one
 * failure mode ("the single onward_report_log UPDATE failed"), so there is no
 * failure domain to couple by merging (adversarial-verified in the fleet
 * review). Collapsed into one multi-trigger fn keyed on event.name.
 */

interface OnwardEventData {
  log_id: string;
  scam_report_id: number;
  destination_key: string;
}

type Marker = {
  status: "skipped" | "sent";
  reason: string;
  action: string;
};

// event.name → the (status, reason, action) triple to record. Adding a
// deep-link/audit destination = one entry here (the trigger list below is
// derived from these keys, so this is the single source of truth).
export const ONWARD_MARKERS: Record<string, Marker> = {
  "report.onward.scamwatch": {
    status: "skipped",
    reason: "no_api_user_redirect_required",
    action: "user_redirect",
  },
  "report.onward.reportcyber": {
    status: "skipped",
    reason: "no_api_user_redirect_required",
    action: "user_redirect",
  },
  "report.onward.idcare": {
    status: "skipped",
    reason: "phone_handoff_user_action_required",
    action: "phone_handoff",
  },
  "report.onward.ask_arthur_feed": {
    status: "sent",
    reason: "audit_marker_only",
    action: "audit_marker",
  },
};

async function markStatus(logId: string, status: Marker["status"], reason: string) {
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

export const onwardMarkers = inngest.createFunction(
  {
    id: "report-onward-markers",
    // Carried over from the widest of the four originals (scamwatch); trivial
    // single-row writes with retries:0 don't need more.
    concurrency: { limit: 2 },
    timeouts: { finish: "1m" },
    name: "Onward report: deep-link / audit markers",
    retries: 0,
  },
  // Triggers derived from the marker map keys — no drift between the two.
  Object.keys(ONWARD_MARKERS).map((event) => ({ event })) as [
    { event: string },
    ...{ event: string }[],
  ],
  withAxiomLogging({ fnId: "report-onward-markers" }, async ({ event, step }) => {
    const data = event.data as OnwardEventData;
    const marker = ONWARD_MARKERS[event.name];
    if (!marker) {
      // Unreachable given the trigger list, but fail loud rather than silently
      // leaving the log row 'queued'.
      return { ok: false, reason: `unknown_onward_marker_event:${event.name}` };
    }
    await step.run("mark", () =>
      markStatus(data.log_id, marker.status, marker.reason),
    );
    return { ok: true, action: marker.action };
  }),
);
