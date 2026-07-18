// Pure-helper tests for the "Next brand to email" worklist presenters.
// The ranking + candidate resolution lives in the SQL RPC (v241); these
// cover the TypeScript that shapes each row for the UI.

import { describe, it, expect } from "vitest";
import {
  type WorklistRow,
  signalSummary,
  buildHookLine,
  buildComposerBody,
  bucketWorklist,
} from "@/lib/email/brand-outreach-worklist";

function makeRow(over: Partial<WorklistRow> = {}): WorklistRow {
  return {
    brand_key: "kmart.com.au",
    brand_name: "Kmart",
    weaponised_count: 0,
    live_unactioned_count: 0,
    total_clones: 1,
    reported_count_30d: 0,
    in_campaign: false,
    campaign_domain_count: null,
    latest_weaponised_at: null,
    has_contact: true,
    contact_recipient: "security@kmart.com.au",
    contact_channel: "security_txt",
    contacted_recently: false,
    last_contacted_at: null,
    likely_enterprise: false,
    ...over,
  };
}

describe("signalSummary", () => {
  it("lists non-zero signals then the total", () => {
    const s = signalSummary(
      makeRow({
        weaponised_count: 3,
        live_unactioned_count: 14,
        in_campaign: true,
        campaign_domain_count: 28,
        total_clones: 40,
      }),
    );
    expect(s).toContain("3 weaponised");
    expect(s).toContain("14 live");
    expect(s).toContain("28-domain campaign");
    expect(s).toContain("40 lookalikes total");
  });

  it("shows just the total for a quiet brand", () => {
    expect(signalSummary(makeRow({ total_clones: 1 }))).toBe("1 lookalike total");
  });
});

describe("buildHookLine", () => {
  it("leads with campaign coordination when in a campaign", () => {
    const h = buildHookLine(
      makeRow({ in_campaign: true, campaign_domain_count: 28, weaponised_count: 2 }),
    );
    expect(h).toContain("coordinated campaign");
    expect(h).toContain("28 lookalike domains");
    expect(h).toContain("Kmart");
  });

  it("leads with weaponisation urgency when phishing is live (no campaign)", () => {
    const h = buildHookLine(makeRow({ weaponised_count: 3 }));
    expect(h).toContain("3 live phishing sites");
    expect(h).toContain("Kmart");
  });

  it("falls back to lookalike volume when nothing is live", () => {
    const h = buildHookLine(makeRow({ total_clones: 5 }));
    expect(h).toContain("5 lookalike domains");
  });
});

describe("buildComposerBody", () => {
  it("keeps the {{hook}} greeting token and embeds the pitch + offer", () => {
    const body = buildComposerBody(makeRow({ weaponised_count: 2 }));
    expect(body).toContain("{{hook}}"); // founder still names a person
    expect(body).toContain("2 live phishing sites");
    expect(body).toContain("A$300");
    expect(body).toContain("First month free");
  });
});

describe("bucketWorklist", () => {
  it("splits into eligible / contacted / enterprise with contacted taking precedence", () => {
    const rows = [
      makeRow({ brand_key: "a", weaponised_count: 5 }), // eligible
      makeRow({ brand_key: "b", likely_enterprise: true }), // enterprise
      makeRow({ brand_key: "c", contacted_recently: true }), // contacted
      // enterprise AND contacted → contacted wins (precedence)
      makeRow({ brand_key: "d", likely_enterprise: true, contacted_recently: true }),
    ];
    const { eligible, contacted, enterprise } = bucketWorklist(rows);
    expect(eligible.map((r) => r.brand_key)).toEqual(["a"]);
    expect(enterprise.map((r) => r.brand_key)).toEqual(["b"]);
    expect(contacted.map((r) => r.brand_key)).toEqual(["c", "d"]);
  });

  it("preserves input order within a bucket", () => {
    const rows = [
      makeRow({ brand_key: "x", weaponised_count: 9 }),
      makeRow({ brand_key: "y", weaponised_count: 4 }),
    ];
    expect(bucketWorklist(rows).eligible.map((r) => r.brand_key)).toEqual(["x", "y"]);
  });
});
