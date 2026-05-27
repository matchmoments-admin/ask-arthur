import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  buildSubmissionReason,
  NETCRAFT_REPORT_ENDPOINT_URL,
} from "@/app/api/inngest/functions/clone-watch-submit-netcraft";
import { decideNotificationAction } from "@/app/api/inngest/functions/clone-watch-notify-brand";
import {
  buildLinkedInDraft,
  buildTelegramMessage,
  brandDisplayName,
  type WeeklyMetrics,
} from "@/app/api/inngest/functions/clone-watch-weekly-digest";
import {
  classifyScan,
  suggestTriageTransition,
  PARKED_HOST_PATTERNS,
  serialiseSubmitFailure,
  serialiseRetrievalTimeout,
} from "@/app/api/inngest/functions/clone-watch-urlscan";
import {
  groupByBrandRecipient,
  buildBatchSubject,
  buildTelegramSummaryMessage,
} from "@/app/api/inngest/functions/clone-watch-notify-brand-prepare";
import {
  buildScamwatchCsv,
  clampDays,
  csvField,
  firstSignal,
} from "@/app/api/admin/clone-watch/scamwatch-export/route";
import type { URLScanResult } from "@askarthur/scam-engine/urlscan";

// Covers the pure helpers that route channels, build outbound copy, and
// shape the Netcraft submission. The Inngest step machinery itself
// (createServiceClient, Resend, sendAdminTelegramMessage) is not tested
// here — those are exercised by the live e2e flow once a row is triaged.

describe("clone-watch-submit-netcraft", () => {
  describe("buildSubmissionReason", () => {
    it("includes the brand, signal type, and 2-decimal score", () => {
      const reason = buildSubmissionReason({
        brand: "kmart.com.au",
        candidateDomain: "qkmart.com",
        signalType: "levenshtein",
        score: 0.8333333,
      });
      expect(reason).toContain("kmart.com.au");
      expect(reason).toContain("levenshtein");
      expect(reason).toContain("0.83");
      expect(reason).toContain("Ask Arthur clone-watch");
    });

    it("formats score consistently regardless of input precision", () => {
      const reason = buildSubmissionReason({
        brand: "Bonds",
        candidateDomain: "bons.bid",
        signalType: "levenshtein",
        score: 0.8,
      });
      expect(reason).toContain("0.80");
    });
  });

  describe("NETCRAFT_REPORT_ENDPOINT_URL", () => {
    it("points at v3 of the Netcraft Report API", () => {
      expect(NETCRAFT_REPORT_ENDPOINT_URL).toBe(
        "https://report.netcraft.com/api/v3/report",
      );
    });
  });
});

describe("clone-watch-notify-brand — decideNotificationAction", () => {
  const baseRow = {
    brand: "Kmart",
    legitimate_domain: "kmart.com.au",
    recipient: "https://bugcrowd.com/kmartaustralia-vdp-pro",
    evidence_format: "bugcrowd_form",
    notes: null,
  };

  it("returns no_directory_row when the brand isn't in the directory", () => {
    const action = decideNotificationAction(null);
    expect(action).toEqual({ kind: "skip", reason: "no_directory_row" });
  });

  it("routes 'none' channel to skip", () => {
    const action = decideNotificationAction({
      ...baseRow,
      channel_type: "none",
    });
    expect(action).toEqual({ kind: "skip", reason: "channel_none" });
  });

  it("routes bugcrowd_vdp to manual_action (Kmart Group VDP)", () => {
    const action = decideNotificationAction({
      ...baseRow,
      channel_type: "bugcrowd_vdp",
    });
    expect(action).toEqual({ kind: "manual_action", channel: "bugcrowd_vdp" });
  });

  it("routes contact_form to manual_action", () => {
    const action = decideNotificationAction({
      ...baseRow,
      channel_type: "contact_form",
    });
    expect(action).toEqual({ kind: "manual_action", channel: "contact_form" });
  });

  it("routes manual_review (unverified brands) to manual_action", () => {
    const action = decideNotificationAction({
      ...baseRow,
      channel_type: "manual_review",
      recipient: null,
    });
    expect(action).toEqual({
      kind: "manual_action",
      channel: "manual_review",
    });
  });

  it("routes security_txt with recipient to email", () => {
    const action = decideNotificationAction({
      ...baseRow,
      channel_type: "security_txt",
      recipient: "security@auspost.com.au",
    });
    expect(action).toEqual({ kind: "email", channel: "security_txt" });
  });

  it("routes fraud_inbox with recipient to email", () => {
    const action = decideNotificationAction({
      ...baseRow,
      channel_type: "fraud_inbox",
      recipient: "abuse@example.com",
    });
    expect(action).toEqual({ kind: "email", channel: "fraud_inbox" });
  });

  it("skips when security_txt has no recipient (corrupt directory row)", () => {
    const action = decideNotificationAction({
      ...baseRow,
      channel_type: "security_txt",
      recipient: null,
    });
    expect(action).toEqual({
      kind: "skip",
      reason: "directory_recipient_null",
    });
  });

  it("skips when fraud_inbox has no recipient", () => {
    const action = decideNotificationAction({
      ...baseRow,
      channel_type: "fraud_inbox",
      recipient: null,
    });
    expect(action).toEqual({
      kind: "skip",
      reason: "directory_recipient_null",
    });
  });

  // PR-B Phase 1 calibration: severity-gated routing for email channels.
  describe("severity gate", () => {
    const securityRow = {
      ...baseRow,
      channel_type: "security_txt" as const,
      recipient: "security@example.com",
    };

    it("routes critical severity to immediate email", () => {
      const action = decideNotificationAction(securityRow, "critical");
      expect(action).toEqual({ kind: "email", channel: "security_txt" });
    });

    it("routes high severity to immediate email", () => {
      const action = decideNotificationAction(securityRow, "high");
      expect(action).toEqual({ kind: "email", channel: "security_txt" });
    });

    it("routes medium severity to immediate email (no-regression default)", () => {
      const action = decideNotificationAction(securityRow, "medium");
      expect(action).toEqual({ kind: "email", channel: "security_txt" });
    });

    it("routes low severity to immediate email (admin TP-confirm = no noise floor)", () => {
      // Pre-2026-05-27 this returned { kind: 'enqueue_digest', severity:'low' }
      // and the handler scheduled for next-Sunday digest. That gate was
      // removed because this consumer only fires post-admin-TP-confirm —
      // there is no auto-noise to throttle against. See PR
      // fix/clone-watch-scheduled-for-now.
      const action = decideNotificationAction(securityRow, "low");
      expect(action).toEqual({ kind: "email", channel: "security_txt" });
    });

    it("defaults to medium (immediate email) when severity is omitted", () => {
      const action = decideNotificationAction(securityRow);
      expect(action).toEqual({ kind: "email", channel: "security_txt" });
    });

    it("low severity on fraud_inbox also routes to immediate email", () => {
      const action = decideNotificationAction(
        { ...securityRow, channel_type: "fraud_inbox" },
        "low",
      );
      expect(action).toEqual({ kind: "email", channel: "fraud_inbox" });
    });

    it("low severity does NOT bypass manual_action routing for VDPs", () => {
      // bugcrowd_vdp / contact_form / manual_review always go to manual_action
      // regardless of severity — the channel constraint dominates.
      const action = decideNotificationAction(
        { ...baseRow, channel_type: "bugcrowd_vdp" },
        "low",
      );
      expect(action).toEqual({ kind: "manual_action", channel: "bugcrowd_vdp" });
    });

    it("low severity does NOT bypass null-recipient skip", () => {
      const action = decideNotificationAction(
        { ...securityRow, recipient: null },
        "low",
      );
      expect(action).toEqual({
        kind: "skip",
        reason: "directory_recipient_null",
      });
    });
  });
});

describe("clone-watch-weekly-digest — pure formatters", () => {
  const baseMetrics: WeeklyMetrics = {
    candidates_total: 47,
    triaged_tp: 14,
    triaged_fp: 25,
    triaged_investigate: 5,
    pending: 3,
    brands_touched: 8,
    submissions_netcraft: 14,
    notifications_sent: 12,
  };

  const baseBrands = [
    { brand: "kmart.com.au", count: 5 },
    { brand: "westpac.com.au", count: 3 },
    { brand: "auspost.com.au", count: 2 },
  ];

  describe("brandDisplayName", () => {
    it("strips the TLD and capitalises the root for social copy", () => {
      expect(brandDisplayName("kmart.com.au")).toBe("Kmart");
      expect(brandDisplayName("auspost.com.au")).toBe("Auspost");
      expect(brandDisplayName("sendle.com")).toBe("Sendle");
    });

    it("falls back to the raw string when there's no dot", () => {
      expect(brandDisplayName("kmart")).toBe("Kmart");
    });
  });

  describe("buildLinkedInDraft", () => {
    it("names top brands as titlecase, anonymises operators", () => {
      const draft = buildLinkedInDraft({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        brandBreakdown: baseBrands,
        reportedBrands: [],
      });
      expect(draft).toContain("Kmart");
      expect(draft).toContain("Westpac");
      // Aggregate numbers must appear
      expect(draft).toContain("47 candidate");
      expect(draft).toContain("8 Australian brands");
      // No operator domain names — anonymised by design
      expect(draft).not.toContain("qkmart.com");
      expect(draft).not.toContain(".bid");
    });

    it("falls back to 'quiet week' messaging when no confirmed TPs", () => {
      const draft = buildLinkedInDraft({
        period: "20 May – 26 May",
        metrics: { ...baseMetrics, triaged_tp: 0 },
        brandBreakdown: [],
        reportedBrands: [],
      });
      expect(draft).toContain("Quiet week");
    });

    it("includes the contact email + utm-able CTA", () => {
      const draft = buildLinkedInDraft({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        brandBreakdown: baseBrands,
        reportedBrands: [],
      });
      expect(draft).toContain("brendan@askarthur.au");
      expect(draft).toContain("#scamprotection");
    });

    it("names brands we reported to directly when reportedBrands is non-empty", () => {
      const draft = buildLinkedInDraft({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        brandBreakdown: baseBrands,
        reportedBrands: ["nab.com.au", "westpac.com.au", "auspost.com.au"],
      });
      expect(draft).toContain("Reported directly to security teams at:");
      expect(draft).toContain("Nab");
      expect(draft).toContain("Westpac");
      expect(draft).toContain("Auspost");
    });

    it("omits the 'reported to' line when no direct-email channels fired", () => {
      const draft = buildLinkedInDraft({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        brandBreakdown: baseBrands,
        reportedBrands: [],
      });
      expect(draft).not.toContain("Reported directly to security teams at:");
    });
  });

  describe("buildTelegramMessage", () => {
    it("includes the LinkedIn draft inside a <pre> block for copy-paste", () => {
      const linkedinDraft = "Test draft body";
      const message = buildTelegramMessage({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        tpRate: 30,
        fpRate: 53,
        brandBreakdown: baseBrands,
        reportedBrands: [],
        linkedinDraft,
      });
      expect(message).toContain("LinkedIn-post draft");
      expect(message).toContain(`<pre>${linkedinDraft}</pre>`);
    });

    it("links the admin triage queue so the operator can drill in", () => {
      const message = buildTelegramMessage({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        tpRate: 30,
        fpRate: 53,
        brandBreakdown: baseBrands,
        reportedBrands: [],
        linkedinDraft: "x",
      });
      expect(message).toContain("askarthur.au/admin/clone-watch");
    });

    it("shows '(no confirmed TPs this week)' italic when brand list is empty", () => {
      const message = buildTelegramMessage({
        period: "20 May – 26 May",
        metrics: { ...baseMetrics, triaged_tp: 0 },
        tpRate: 0,
        fpRate: 53,
        brandBreakdown: [],
        reportedBrands: [],
        linkedinDraft: "x",
      });
      expect(message).toContain("no confirmed TPs this week");
    });

    it("html-escapes brand strings to defend against jsonb injection", () => {
      const message = buildTelegramMessage({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        tpRate: 30,
        fpRate: 53,
        brandBreakdown: [{ brand: "<script>alert(1)</script>", count: 1 }],
        reportedBrands: [],
        linkedinDraft: "x",
      });
      expect(message).not.toContain("<script>alert(1)</script>");
      expect(message).toContain("&lt;script&gt;");
    });

    it("shows the 'Reported directly to' line when reportedBrands non-empty", () => {
      const message = buildTelegramMessage({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        tpRate: 30,
        fpRate: 53,
        brandBreakdown: baseBrands,
        reportedBrands: ["nab.com.au", "westpac.com.au"],
        linkedinDraft: "x",
      });
      expect(message).toContain("Reported directly to");
      expect(message).toContain("Nab");
      expect(message).toContain("Westpac");
    });
  });
});

describe("clone-watch-urlscan — classifyScan", () => {
  const baseResult: URLScanResult = {
    scanId: "abc",
    screenshotUrl: "https://urlscan.io/screenshots/abc.png",
    effectiveUrl: "https://example.com/",
    malicious: false,
    score: 0,
    categories: [],
    technologies: [],
    serverInfo: { ip: "1.2.3.4", country: "AU", asn: "AS123" },
    domainAge: null,
  };

  it("classifies a null result as unresolved", () => {
    expect(classifyScan(null)).toBe("unresolved");
  });

  it("classifies an empty effectiveUrl as unresolved", () => {
    expect(classifyScan({ ...baseResult, effectiveUrl: "" })).toBe("unresolved");
  });

  it("classifies Afternic-hosted effective URL as parked_for_sale", () => {
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl:
          "https://www.afternic.com/forsale/qkmart.com?utm_medium=parkedpag",
      }),
    ).toBe("parked_for_sale");
  });

  it("classifies Sedo-hosted effective URL as parked_for_sale", () => {
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl: "https://sedo.com/search/details/?domain=example.com",
      }),
    ).toBe("parked_for_sale");
  });

  it("classifies sedoparking subdomains as parked_for_sale", () => {
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl: "https://ns1.sedoparking.com/showcase",
      }),
    ).toBe("parked_for_sale");
  });

  it("does NOT classify subdomain-attack hosts as parked (suffix match)", () => {
    // Pre-F8 fix this matched `afternic.com` via substring → parked.
    // Post-F8 fix uses suffix match (host === p || host.endsWith('.' + p))
    // so attacker-controlled `evilafternic.com.attacker.com` falls through.
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl: "https://evilafternic.com.attacker.com/login",
      }),
    ).toBe("neutral");
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl: "https://fakesedo.com.evil.com/",
      }),
    ).toBe("neutral");
  });

  it("DOES classify legitimate subdomains of marketplace hosts as parked (suffix match)", () => {
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl: "https://parking.afternic.com/forsale/x.com",
      }),
    ).toBe("parked_for_sale");
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl: "https://www.dan.com/buy-domain/x.com",
      }),
    ).toBe("parked_for_sale");
  });

  it("classifies urlscan-flagged malicious as likely_phishing", () => {
    expect(
      classifyScan({ ...baseResult, malicious: true }),
    ).toBe("likely_phishing");
  });

  it("classifies a benign resolving page as neutral", () => {
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl: "https://westpachomesb.info/",
      }),
    ).toBe("neutral");
  });

  it("does not treat brand-like hostnames as parked unless on a marketplace", () => {
    expect(
      classifyScan({
        ...baseResult,
        effectiveUrl: "https://qkmart.com/login",
      }),
    ).toBe("neutral");
  });

  it("handles malformed effective URLs gracefully", () => {
    // Invalid URL → safeHostOf returns null → not parked, not malicious → neutral
    expect(
      classifyScan({ ...baseResult, effectiveUrl: "not a url" }),
    ).toBe("neutral");
  });
});

describe("clone-watch-urlscan — suggestTriageTransition", () => {
  it("returns null for likely_phishing — operator manually confirms (F5)", () => {
    // Pre-F5: this returned 'tp_confirmed', which dropped the row off the
    // pending queue + skipped event-emit → row became invisible + inert.
    // Post-F5: returns null so the chip surfaces on the dashboard +
    // operator confirms TP manually, which emits the event correctly.
    expect(suggestTriageTransition("likely_phishing")).toBeNull();
  });

  it("downgrades parked_for_sale → needs_investigation", () => {
    expect(suggestTriageTransition("parked_for_sale")).toBe(
      "needs_investigation",
    );
  });

  it("downgrades unresolved → needs_investigation", () => {
    expect(suggestTriageTransition("unresolved")).toBe("needs_investigation");
  });

  it("returns null for neutral (leave alone for human review)", () => {
    expect(suggestTriageTransition("neutral")).toBeNull();
  });
});

describe("clone-watch-urlscan — PARKED_HOST_PATTERNS", () => {
  it("includes the major domain marketplace operators", () => {
    expect(PARKED_HOST_PATTERNS).toContain("afternic.com");
    expect(PARKED_HOST_PATTERNS).toContain("sedo.com");
    expect(PARKED_HOST_PATTERNS).toContain("dan.com");
  });
});

// Issue #441 regression coverage — the persist-on-failure paths write a
// non-null urlscan_scanned_at so tomorrow's rescan cron picks the row
// back up. Without these stubs the row was stuck forever.
describe("clone-watch-urlscan — failure-evidence serialisers (#441)", () => {
  describe("serialiseSubmitFailure", () => {
    it("records the urlscan error reason + http status for rate limits", () => {
      const ev = serialiseSubmitFailure({
        ok: false,
        error: "rate_limited",
        status: 429,
        message: "Too Many Requests",
      });
      expect(ev.submit_failed).toBe(true);
      expect(ev.error).toBe("rate_limited");
      expect(ev.status).toBe(429);
      expect(ev.message).toBe("Too Many Requests");
      expect(typeof ev.attempted_at).toBe("string");
    });

    it("records 'rejected' with the 400-body for blocklisted candidates", () => {
      // alert 468 (westpachomesb.info) shape — urlscan refuses some
      // candidates with a 400 + descriptive body.
      const ev = serialiseSubmitFailure({
        ok: false,
        error: "rejected",
        status: 400,
        message: "Submission failed: scanning this URL is not allowed",
      });
      expect(ev.error).toBe("rejected");
      expect(ev.status).toBe(400);
      expect((ev.message as string)).toContain("not allowed");
    });

    it("handles network errors with no status code", () => {
      const ev = serialiseSubmitFailure({
        ok: false,
        error: "network_error",
        message: "Error: getaddrinfo ENOTFOUND",
      });
      expect(ev.status).toBeNull();
      expect(ev.error).toBe("network_error");
    });

    it("handles no-api-key without a message", () => {
      const ev = serialiseSubmitFailure({ ok: false, error: "no_api_key" });
      expect(ev.status).toBeNull();
      expect(ev.message).toBeNull();
    });
  });

  describe("serialiseRetrievalTimeout", () => {
    it("records the uuid so a future operator can manually re-fetch", () => {
      const ev = serialiseRetrievalTimeout("019e6233-a2ba-7308-ba79-b2bbe38aefc0");
      expect(ev.uuid).toBe("019e6233-a2ba-7308-ba79-b2bbe38aefc0");
      expect(ev.retrieved).toBe(false);
      expect(ev.retrieval_timeout).toBe(true);
      expect(typeof ev.scanned_at).toBe("string");
    });
  });
});

// PR-B2 — approval-gated daily-batch flow.
describe("clone-watch-notify-brand-prepare — pure helpers", () => {
  describe("groupByBrandRecipient", () => {
    const baseRow = (over: Partial<{ id: number; brand: string; recipient: string; candidate_domain: string }>) => ({
      id: over.id ?? 1,
      alert_id: 100 + (over.id ?? 1),
      brand: over.brand ?? "kmart.com.au",
      candidate_domain: over.candidate_domain ?? "qkmart.com",
      candidate_url: "https://" + (over.candidate_domain ?? "qkmart.com"),
      recipient: over.recipient ?? "vulnerabilitydisclosure@bigw.com.au",
      channel_type: "fraud_inbox",
      severity_tier: "medium",
      enqueued_at: "2026-05-26T03:00:00.000Z",
    });

    it("groups 5 Kmart hits into ONE batch per recipient (user feedback)", () => {
      const rows = [1, 2, 3, 4, 5].map((i) =>
        baseRow({ id: i, candidate_domain: `kmart-clone-${i}.com` }),
      );
      const groups = groupByBrandRecipient(rows);
      expect(groups).toHaveLength(1);
      expect(groups[0].rows).toHaveLength(5);
      expect(groups[0].brand).toBe("kmart.com.au");
    });

    it("splits across brands", () => {
      const rows = [
        baseRow({ id: 1, brand: "kmart.com.au", recipient: "kmart@x.com" }),
        baseRow({ id: 2, brand: "westpac.com.au", recipient: "westpac@x.com" }),
        baseRow({ id: 3, brand: "kmart.com.au", recipient: "kmart@x.com" }),
      ];
      const groups = groupByBrandRecipient(rows);
      expect(groups).toHaveLength(2);
      const kmart = groups.find((g) => g.brand === "kmart.com.au");
      expect(kmart?.rows).toHaveLength(2);
    });

    it("splits across recipients for the same brand", () => {
      const rows = [
        baseRow({ id: 1, recipient: "a@x.com" }),
        baseRow({ id: 2, recipient: "b@x.com" }),
      ];
      const groups = groupByBrandRecipient(rows);
      expect(groups).toHaveLength(2);
    });
  });

  describe("buildBatchSubject", () => {
    const group = (count: number) => ({
      brand: "kmart.com.au",
      recipient: "x@y.com",
      channel_type: "fraud_inbox",
      rows: Array.from({ length: count }, (_, i) => ({
        id: i,
        alert_id: i,
        brand: "kmart.com.au",
        candidate_domain: `clone-${i}.com`,
        candidate_url: "https://x",
        recipient: "x@y.com",
        channel_type: "fraud_inbox",
        severity_tier: "medium",
        enqueued_at: "2026-05-26T03:00:00.000Z",
      })),
    });

    it("uses the single-domain shape when count === 1", () => {
      const s = buildBatchSubject(group(1));
      expect(s).toBe("Possible clone of kmart.com.au — clone-0.com");
    });

    it("uses the consolidated shape when count > 1", () => {
      const s = buildBatchSubject(group(5));
      expect(s).toContain("5 possible clones of kmart.com.au");
    });
  });

  describe("buildTelegramSummaryMessage", () => {
    it("renders single-batch wording with the dashboard URL", () => {
      const msg = buildTelegramSummaryMessage({
        batchesPrepared: 1,
        groupsFailed: 0,
        groupsSkippedCooldown: 0,
        dashboardUrl: "https://askarthur.au/admin/clone-watch#approvals",
      });
      expect(msg).toContain("1</b> batch awaiting your approval");
      expect(msg).toContain(
        "https://askarthur.au/admin/clone-watch#approvals",
      );
      // Defensive — no HMAC URLs, no per-candidate domain list
      expect(msg).not.toContain("approve-batch");
      expect(msg).not.toContain("reject-batch");
    });

    it("uses plural noun when more than one batch", () => {
      const msg = buildTelegramSummaryMessage({
        batchesPrepared: 7,
        groupsFailed: 0,
        groupsSkippedCooldown: 0,
        dashboardUrl: "https://askarthur.au/admin/clone-watch#approvals",
      });
      expect(msg).toContain("7</b> batches awaiting your approval");
    });

    it("surfaces cooldown-skipped groups so silent skips don't hide", () => {
      const msg = buildTelegramSummaryMessage({
        batchesPrepared: 2,
        groupsFailed: 0,
        groupsSkippedCooldown: 3,
        dashboardUrl: "https://askarthur.au/admin/clone-watch#approvals",
      });
      expect(msg).toContain("3 brands skipped (24h cooldown");
    });

    it("surfaces failed groups with a warning emoji", () => {
      const msg = buildTelegramSummaryMessage({
        batchesPrepared: 2,
        groupsFailed: 1,
        groupsSkippedCooldown: 0,
        dashboardUrl: "https://askarthur.au/admin/clone-watch#approvals",
      });
      expect(msg).toContain("⚠️ 1 group failed");
    });

    it("uses 'No new batches' wording when nothing is pending", () => {
      const msg = buildTelegramSummaryMessage({
        batchesPrepared: 0,
        groupsFailed: 0,
        groupsSkippedCooldown: 2,
        dashboardUrl: "https://askarthur.au/admin/clone-watch#approvals",
      });
      expect(msg).toContain("No new batches awaiting approval");
      expect(msg).toContain("2 brands skipped");
    });
  });
});

// HMAC URL approve/reject routes were removed (replaced by admin-dashboard
// flow). Their tests deleted in the same PR. The dashboard POST routes
// rely on `requireAdmin()` for auth + Zod for body shape — exercised by
// the live e2e flow rather than unit tests here.

describe("clone-watch-notify-brand-prepare — idempotency contract (migration v151)", () => {
  // The idempotency guarantee of the daily prepare cron lives entirely at
  // the SQL layer, not in TypeScript. Two contracts to lock:
  //
  //   1. list_clone_alerts_unbatched_for_prepare MUST filter on
  //      approval_status = 'unbatched' so already-batched rows
  //      (state = 'pending' / 'sent' / 'auto_approved' / 'rejected') are
  //      invisible to subsequent runs.
  //   2. assign_clone_alert_batch MUST transition rows OUT of 'unbatched'
  //      (to 'pending' or 'auto_approved') AND require WHERE
  //      approval_status = 'unbatched' as a defense-in-depth gate.
  //
  // Together these mean a re-run of the prepare cron on the same day
  // returns zero new batches. The handler-level Inngest behavioural test
  // is tracked as deferred issue #428 (would require mock-supabase + step
  // machinery the codebase doesn't have today); this snapshot test is the
  // pragmatic substitute — catches the regression if a future migration
  // edits these RPCs to drop either filter.
  const migration = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "supabase",
      "migration-v151-clone-watch-notification-approval.sql",
    ),
    "utf8",
  );

  it("list_clone_alerts_unbatched_for_prepare filters on approval_status = 'unbatched'", () => {
    // Extract the function body — between the AS $$ that follows the
    // function name and the next $$.
    const fnMatch = migration.match(
      /CREATE OR REPLACE FUNCTION public\.list_clone_alerts_unbatched_for_prepare[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![1];
    expect(body).toMatch(/approval_status\s*=\s*'unbatched'/);
  });

  it("assign_clone_alert_batch transitions out of 'unbatched' AND gates on 'unbatched'", () => {
    const fnMatch = migration.match(
      /CREATE OR REPLACE FUNCTION public\.assign_clone_alert_batch[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![1];
    // Transitions TO 'pending' (default) and 'auto_approved' (skip approval).
    expect(body).toMatch(/'pending'/);
    expect(body).toMatch(/'auto_approved'/);
    // Defense-in-depth WHERE clause: even if the caller passes ids that are
    // already-batched, the UPDATE is a no-op for non-'unbatched' rows.
    expect(body).toMatch(/WHERE\s+id\s*=\s*ANY\(p_queue_ids\)[\s\S]*?approval_status\s*=\s*'unbatched'/);
  });
});

// v152 hardening: concurrency-safe transition + retention.
describe("clone-watch hardening — migration v152 contract snapshot", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "supabase",
      "migration-v152-clone-watch-hardening.sql",
    ),
    "utf8",
  );

  it("transition_clone_alert_batch takes a row-level lock (FOR UPDATE)", () => {
    // Capture the whole function definition (signature + body) so we can
    // assert on both the RETURNS TABLE shape and the executable body.
    const fnMatch = migration.match(
      /CREATE OR REPLACE FUNCTION public\.transition_clone_alert_batch[\s\S]*?\$\$;/,
    );
    expect(fnMatch).not.toBeNull();
    const full = fnMatch![0];
    // The lock is what makes concurrent Send safe — two callers serialise here.
    expect(full).toMatch(/FOR UPDATE/);
    // Returns structured outcome so the route can distinguish race outcomes.
    expect(full).toMatch(/observed_status/);
    expect(full).toMatch(/observed_brand/);
    expect(full).toMatch(/observed_recipient/);
    // Audit trail: admin id is stamped on the row.
    expect(full).toMatch(/approved_by_admin_id/);
    expect(full).toMatch(/rejected_by_admin_id/);
  });

  it("drops the legacy 3-arg overload so callers can't accidentally bypass admin_id", () => {
    expect(migration).toMatch(
      /DROP FUNCTION IF EXISTS public\.transition_clone_alert_batch\(uuid, text, text\)/,
    );
  });

  it("brand cooldown lookup is capped at 168h (one week) of staleness", () => {
    const fnMatch = migration.match(
      /CREATE OR REPLACE FUNCTION public\.list_recently_notified_brands[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/LEAST\(p_cooldown_hours, 168\)/);
  });

  it("retention RPCs are chunked at ≤5K rows per call (hot-table convention)", () => {
    for (const fn of [
      "expire_stale_pending_clone_batches",
      "purge_old_clone_alert_queue_rows",
      "purge_old_fp_clone_alerts",
    ]) {
      const fnMatch = migration.match(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$`),
      );
      expect(fnMatch, `function ${fn} not found`).not.toBeNull();
      expect(fnMatch![1]).toMatch(/LEAST\(p_chunk_size, 5000\)/);
    }
  });

  it("purge_old_fp_clone_alerts deletes ONLY 'fp' rows — TP-confirmed history is preserved", () => {
    const fnMatch = migration.match(
      /CREATE OR REPLACE FUNCTION public\.purge_old_fp_clone_alerts[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![1];
    expect(body).toMatch(/triage_status\s*=\s*'fp'/);
    // No accidental tp_confirmed / tp_actioned reference.
    expect(body).not.toMatch(/tp_confirmed/);
    expect(body).not.toMatch(/tp_actioned/);
  });

  it("record_brand_notification_sent stamps last_notified_at on the directory row", () => {
    const fnMatch = migration.match(
      /CREATE OR REPLACE FUNCTION public\.record_brand_notification_sent[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![1];
    expect(body).toMatch(/last_notified_at\s*=\s*now\(\)/);
    expect(body).toMatch(/brand_contact_directory/);
    // And merges submitted_to.brand_notification.status='sent'.
    expect(body).toMatch(/'status',\s*'sent'/);
    expect(body).toMatch(/shopfront_clone_alerts/);
  });
});

describe("scamwatch-export — pure helpers", () => {
  describe("clampDays", () => {
    it("returns 7 on NaN / missing", () => {
      expect(clampDays(Number.NaN)).toBe(7);
      expect(clampDays(0)).toBe(7);
      expect(clampDays(-3)).toBe(7);
    });

    it("caps at 90", () => {
      expect(clampDays(91)).toBe(90);
      expect(clampDays(365)).toBe(90);
    });

    it("returns the integer floor of valid input", () => {
      expect(clampDays(7)).toBe(7);
      expect(clampDays(30)).toBe(30);
      expect(clampDays(7.9)).toBe(7);
    });
  });

  describe("firstSignal", () => {
    it("extracts signal_type + score from the first jsonb entry", () => {
      expect(
        firstSignal([{ signal_type: "levenshtein", score: 0.8333 }]),
      ).toEqual({ signal_type: "levenshtein", score: 0.8333 });
    });

    it("returns empty string + NaN for malformed jsonb", () => {
      expect(firstSignal(null)).toEqual({ signal_type: "", score: NaN });
      expect(firstSignal([])).toEqual({ signal_type: "", score: NaN });
      expect(firstSignal("not-an-array")).toEqual({
        signal_type: "",
        score: NaN,
      });
      expect(firstSignal([{}])).toEqual({ signal_type: "", score: NaN });
    });
  });

  describe("csvField (RFC 4180)", () => {
    it("returns plain unquoted value when no special chars", () => {
      expect(csvField("kmart")).toBe("kmart");
      expect(csvField(0.83)).toBe("0.83");
    });

    it("quotes + escapes embedded quotes", () => {
      expect(csvField('say "hi"')).toBe('"say ""hi"""');
    });

    it("quotes when value contains a comma", () => {
      expect(csvField("Sydney, NSW")).toBe('"Sydney, NSW"');
    });

    it("quotes when value contains a newline (defends against CSV injection)", () => {
      expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    });

    it("empty string for null / undefined", () => {
      expect(csvField(null)).toBe("");
      expect(csvField(undefined)).toBe("");
    });
  });

  describe("buildScamwatchCsv", () => {
    it("returns just the header on empty input (with trailing CRLF)", () => {
      expect(buildScamwatchCsv([])).toBe(
        "first_seen_iso,confirmed_at_iso,scam_url,scam_domain,impersonated_brand,scam_type,evidence_signal,evidence_score,severity,source,reporter_email\r\n",
      );
    });

    it("emits one row per alert with all 11 columns + CRLF", () => {
      const csv = buildScamwatchCsv([
        {
          id: 1,
          inferred_target_domain: "nab.com.au",
          candidate_domain: "naab.com",
          candidate_url: "https://naab.com/login",
          first_seen_at: "2026-05-26T03:14:00Z",
          triage_at: "2026-05-26T08:00:00Z",
          severity_tier: "medium",
          signals: [{ signal_type: "levenshtein", score: 0.83 }],
        },
      ]);
      const lines = csv.split("\r\n");
      expect(lines).toHaveLength(3); // header + 1 row + trailing empty
      const cells = lines[1].split(",");
      expect(cells).toHaveLength(11);
      expect(cells).toContain("nab.com.au");
      expect(cells).toContain("naab.com");
      expect(cells).toContain("https://naab.com/login");
      expect(cells).toContain("Phishing - brand impersonation");
      expect(cells).toContain("levenshtein");
      expect(cells).toContain("0.83");
      expect(cells).toContain("medium");
      expect(cells).toContain("Ask Arthur clone-watch");
      expect(cells).toContain("brendan@askarthur.au");
    });

    it("html-safe escaping isn't applied (CSV, not HTML) — but quote-escape is", () => {
      const csv = buildScamwatchCsv([
        {
          id: 2,
          inferred_target_domain: "test.com",
          candidate_domain: "te\"st.example",
          candidate_url: "https://te\"st.example/x",
          first_seen_at: "2026-05-26T03:14:00Z",
          triage_at: null,
          severity_tier: null,
          signals: null,
        },
      ]);
      // Embedded quotes get doubled (RFC 4180)
      expect(csv).toContain('"te""st.example"');
      // Empty fields for null severity + missing signal
      expect(csv).toMatch(/Phishing - brand impersonation,,,,/);
    });

    it("score formatted to 2 decimals; empty when missing", () => {
      const csv = buildScamwatchCsv([
        {
          id: 3,
          inferred_target_domain: "x.com",
          candidate_domain: "y.com",
          candidate_url: "https://y.com",
          first_seen_at: "2026-05-26T03:14:00Z",
          triage_at: "2026-05-26T04:00:00Z",
          severity_tier: "low",
          signals: [{ signal_type: "au_token", score: 0.91 }],
        },
        {
          id: 4,
          inferred_target_domain: "x.com",
          candidate_domain: "z.com",
          candidate_url: "https://z.com",
          first_seen_at: "2026-05-26T03:14:00Z",
          triage_at: "2026-05-26T04:00:00Z",
          severity_tier: "low",
          signals: [{ signal_type: "au_token" }],
        },
      ]);
      const lines = csv.split("\r\n");
      // Row 1: score "0.91"
      expect(lines[1]).toContain(",0.91,");
      // Row 2: score missing → empty cell between signal and severity
      expect(lines[2]).toMatch(/au_token,,low/);
    });
  });
});
