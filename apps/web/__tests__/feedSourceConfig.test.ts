import { describe, it, expect } from "vitest";
import { SOURCE_CONFIG, humanizeSource } from "@/lib/feed";

// Regression lock for the 2026-05-16 feed-quality incident.
//
// Prior bug: FeedCard.tsx fell back to SOURCE_CONFIG.reddit for any source
// not in this map, which meant every inbound_* email and every Phase B
// scraper row rendered on the public /scam-feed labelled "Reddit" with a
// chat-bubble icon. The fallback now humanises the raw slug instead.
//
// The properties below would have failed before the fix and pass after.

describe("feed.ts SOURCE_CONFIG", () => {
  // Every slug ingested by the Cloudflare Email Worker + Edge Function
  // must have a SOURCE_CONFIG entry — otherwise once the per-source
  // auto_publish gate flips it true, the row would render with the
  // raw slug as a label (still better than "Reddit", but worse than
  // a curated label).
  const requiredInboundSlugs = [
    "inbound_scamwatch",
    "inbound_acsc",
    "inbound_austrac",
    "inbound_oaic",
    "inbound_afp",
    "inbound_acma",
    "inbound_idcare",
    "inbound_auscert",
    "inbound_ftc",
    "inbound_ato",
    "inbound_krebs",
    "inbound_sans",
    "inbound_tldr_infosec",
    "inbound_thn",
    "inbound_securityweek",
    "inbound_riskybiz",
    "inbound_generic",
  ];

  it.each(requiredInboundSlugs)("registers a source-config for %s", (slug) => {
    expect(SOURCE_CONFIG[slug]).toBeDefined();
    expect(SOURCE_CONFIG[slug].label).not.toBe("Reddit");
    expect(SOURCE_CONFIG[slug].icon).not.toBe("MessageCircle");
  });

  it("registers austrac (Phase B PR-B3 #247)", () => {
    expect(SOURCE_CONFIG.austrac).toBeDefined();
    expect(SOURCE_CONFIG.austrac.label).toBe("AUSTRAC");
    expect(SOURCE_CONFIG.austrac.isRegulator).toBe(true);
  });

  it("flags AU government regulators as isRegulator", () => {
    for (const slug of [
      "inbound_scamwatch",
      "inbound_acsc",
      "inbound_austrac",
      "inbound_oaic",
      "inbound_afp",
      "inbound_acma",
      "inbound_ato",
      "inbound_ftc",
    ]) {
      expect(SOURCE_CONFIG[slug].isRegulator).toBe(true);
    }
  });

  it("does NOT flag journalism / newsletter sources as isRegulator", () => {
    for (const slug of [
      "inbound_krebs",
      "inbound_sans",
      "inbound_tldr_infosec",
      "inbound_thn",
      "inbound_securityweek",
      "inbound_riskybiz",
      "inbound_generic",
    ]) {
      expect(SOURCE_CONFIG[slug].isRegulator).toBeUndefined();
    }
  });
});

describe("humanizeSource", () => {
  it("strips the inbound_ prefix and title-cases", () => {
    expect(humanizeSource("inbound_securityweek")).toBe("Securityweek");
    expect(humanizeSource("inbound_tldr_infosec")).toBe("Tldr Infosec");
  });

  it("never returns 'Reddit' for an unknown slug", () => {
    expect(humanizeSource("future_phase_b_source")).not.toBe("Reddit");
    expect(humanizeSource("inbound_unknown")).not.toBe("Reddit");
  });
});
