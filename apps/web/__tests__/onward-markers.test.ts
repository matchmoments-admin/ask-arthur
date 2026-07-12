import { describe, it, expect } from "vitest";

import { ONWARD_MARKERS } from "@/app/api/inngest/functions/onward-skipped";

// The consolidated deep-link/audit marker fn (2026-07-12 fleet review) keys on
// event.name. If a destination's event name loses its marker entry, the fn
// returns { ok: false } and the onward_report_log row is left 'queued' forever
// — the exact silent-stuck class the review warns about. Lock the mapping.
describe("onward markers — consolidated map", () => {
  it("covers exactly the four deep-link/audit destinations", () => {
    expect(Object.keys(ONWARD_MARKERS).sort()).toEqual([
      "report.onward.ask_arthur_feed",
      "report.onward.idcare",
      "report.onward.reportcyber",
      "report.onward.scamwatch",
    ]);
  });

  it("preserves each destination's original (status, reason, action) triple", () => {
    expect(ONWARD_MARKERS["report.onward.scamwatch"]).toEqual({
      status: "skipped",
      reason: "no_api_user_redirect_required",
      action: "user_redirect",
    });
    expect(ONWARD_MARKERS["report.onward.reportcyber"]).toEqual({
      status: "skipped",
      reason: "no_api_user_redirect_required",
      action: "user_redirect",
    });
    expect(ONWARD_MARKERS["report.onward.idcare"]).toEqual({
      status: "skipped",
      reason: "phone_handoff_user_action_required",
      action: "phone_handoff",
    });
    expect(ONWARD_MARKERS["report.onward.ask_arthur_feed"]).toEqual({
      status: "sent",
      reason: "audit_marker_only",
      action: "audit_marker",
    });
  });

  it("only ever marks 'skipped' or 'sent' (never leaves a row un-acted)", () => {
    for (const m of Object.values(ONWARD_MARKERS)) {
      expect(["skipped", "sent"]).toContain(m.status);
      expect(m.reason.length).toBeGreaterThan(0);
    }
  });
});
