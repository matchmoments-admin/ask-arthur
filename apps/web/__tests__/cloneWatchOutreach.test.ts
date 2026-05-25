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
