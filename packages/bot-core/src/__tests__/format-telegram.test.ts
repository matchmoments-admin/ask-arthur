import { describe, it, expect } from "vitest";
import { toTelegramHTML } from "../format-telegram";
import type { AnalysisResult } from "@askarthur/types";

const makeResult = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
  verdict: "SAFE",
  confidence: 0.95,
  summary: "This message appears to be legitimate.",
  redFlags: [],
  nextSteps: ["No action needed."],
  ...overrides,
});

describe("toTelegramHTML", () => {
  it("formats a SAFE verdict", () => {
    const html = toTelegramHTML(makeResult());
    expect(html).toContain("<b>Verdict: Stay alert</b>");
    expect(html).toContain("95% confidence");
    expect(html).toContain("This message appears to be legitimate.");
    expect(html).toContain("Ask Arthur");
  });

  it("formats a HIGH_RISK verdict with red flags", () => {
    const html = toTelegramHTML(
      makeResult({
        verdict: "HIGH_RISK",
        confidence: 0.92,
        redFlags: ["Urgency language", "Requests personal info"],
        scamType: "phishing",
      })
    );
    expect(html).toContain("<b>Verdict: Looks like a scam</b>");
    expect(html).toContain("92% confidence");
    expect(html).toContain("<b>Red Flags:</b>");
    expect(html).toContain("Urgency language");
    expect(html).toContain("<b>Type:</b> phishing");
  });

  it("escapes HTML in user content", () => {
    const html = toTelegramHTML(
      makeResult({ summary: 'Contains <script>alert("xss")</script>' })
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("limits red flags to 5", () => {
    const flags = Array.from({ length: 10 }, (_, i) => `Flag ${i + 1}`);
    const html = toTelegramHTML(makeResult({ redFlags: flags }));
    expect(html).toContain("Flag 5");
    expect(html).not.toContain("Flag 6");
  });

  it("limits next steps to 3", () => {
    const steps = Array.from({ length: 5 }, (_, i) => `Step ${i + 1}`);
    const html = toTelegramHTML(makeResult({ nextSteps: steps }));
    expect(html).toContain("Step 3");
    expect(html).not.toContain("Step 4");
  });

  it("omits scamType when 'none'", () => {
    const html = toTelegramHTML(makeResult({ scamType: "none" }));
    expect(html).not.toContain("<b>Type:</b>");
  });

  it("does not crash on an enriched shopSignal payload carrying paidProviderVerdict", () => {
    // Stage 0.5 adds an optional referrerSource field to ShopSignal so the
    // Stage-0 measurement window can count mobile-share share of
    // commerce-flagged volume. The formatter is not expected to render
    // referrerSource or paidProviderVerdict at this stage —
    // it just needs to keep emitting the existing shop-signals line
    // without throwing on the enriched payload shape.
    const html = toTelegramHTML(
      makeResult({
        verdict: "SUSPICIOUS",
        redFlags: ["PayID payment requested", "Limited stock urgency"],
        shopSignal: {
          isCommerce: true,
          commerceFlags: ["payid-scam", "urgent-purchase-pressure"],
          generatedAt: "2026-05-19T09:00:00.000Z",
          referrerSource: "instagram-inapp",
          paidProviderVerdict: {
            provider: "apivoid",
            verdict: "suspicious",
            trustScore: 52,
            blacklistDetections: 0,
            flags: ["suspicious-domain"],
            checkedAt: "2026-05-20T09:00:00.000Z",
          },
        },
      })
    );
    expect(html).toContain("Shop signals:");
    expect(html).toContain("payid-scam");
  });
});
