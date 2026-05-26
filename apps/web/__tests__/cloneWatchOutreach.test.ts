import { describe, expect, it } from "vitest";
import {
  buildSubmissionReason,
  NETCRAFT_REPORT_ENDPOINT_URL,
} from "@/app/api/inngest/functions/clone-watch-submit-netcraft";
import {
  decideNotificationAction,
  nextWeeklyDigestSchedule,
} from "@/app/api/inngest/functions/clone-watch-notify-brand";
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

    it("routes low severity to weekly-digest enqueue", () => {
      const action = decideNotificationAction(securityRow, "low");
      expect(action).toEqual({
        kind: "enqueue_digest",
        channel: "security_txt",
        severity: "low",
      });
    });

    it("defaults to medium (immediate email) when severity is omitted", () => {
      const action = decideNotificationAction(securityRow);
      expect(action).toEqual({ kind: "email", channel: "security_txt" });
    });

    it("low severity on fraud_inbox enqueues too", () => {
      const action = decideNotificationAction(
        { ...securityRow, channel_type: "fraud_inbox" },
        "low",
      );
      expect(action).toEqual({
        kind: "enqueue_digest",
        channel: "fraud_inbox",
        severity: "low",
      });
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

describe("clone-watch-notify-brand — nextWeeklyDigestSchedule", () => {
  it("returns Sunday 09:00 UTC when 'now' is a weekday", () => {
    // Tuesday 26 May 2026 at 03:14 UTC → next Sunday is 31 May
    const now = new Date(Date.UTC(2026, 4, 26, 3, 14, 0));
    const next = nextWeeklyDigestSchedule(now);
    expect(next.toISOString()).toBe("2026-05-31T09:00:00.000Z");
  });

  it("skips to the FOLLOWING Sunday when 'now' is already Sunday", () => {
    // Sunday 24 May 2026 at 10:00 UTC (after 09:00 cron) → next Sunday is 31 May
    const now = new Date(Date.UTC(2026, 4, 24, 10, 0, 0));
    const next = nextWeeklyDigestSchedule(now);
    expect(next.toISOString()).toBe("2026-05-31T09:00:00.000Z");
  });

  it("rolls to Sunday from Saturday", () => {
    // Saturday 23 May 2026 at 22:00 UTC → next Sunday is 24 May at 09:00
    const now = new Date(Date.UTC(2026, 4, 23, 22, 0, 0));
    const next = nextWeeklyDigestSchedule(now);
    expect(next.toISOString()).toBe("2026-05-24T09:00:00.000Z");
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
      });
      expect(draft).toContain("Quiet week");
    });

    it("includes the contact email + utm-able CTA", () => {
      const draft = buildLinkedInDraft({
        period: "20 May – 26 May",
        metrics: baseMetrics,
        brandBreakdown: baseBrands,
      });
      expect(draft).toContain("brendan@askarthur.au");
      expect(draft).toContain("#scamprotection");
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
        linkedinDraft: "x",
      });
      expect(message).not.toContain("<script>alert(1)</script>");
      expect(message).toContain("&lt;script&gt;");
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
