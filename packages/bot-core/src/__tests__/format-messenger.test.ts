import { describe, it, expect } from "vitest";
import { toMessengerMessage } from "../format-messenger";
import type { AnalysisResult } from "@askarthur/types";

const makeResult = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
  verdict: "SAFE",
  confidence: 0.95,
  summary: "This message appears to be legitimate.",
  redFlags: [],
  nextSteps: ["No action needed."],
  ...overrides,
});

describe("toMessengerMessage", () => {
  it("formats a SAFE verdict", () => {
    const msg = toMessengerMessage(makeResult());
    expect(msg).toContain("Verdict:");
    expect(msg).toContain("95% confidence");
    expect(msg).toContain("This message appears to be legitimate.");
    expect(msg).toContain("Ask Arthur");
  });

  it("formats a HIGH_RISK verdict with red flags", () => {
    const msg = toMessengerMessage(
      makeResult({
        verdict: "HIGH_RISK",
        confidence: 0.92,
        redFlags: ["Urgency language", "Requests personal info"],
        scamType: "phishing",
      })
    );
    expect(msg).toContain("Verdict:");
    expect(msg).toContain("92% confidence");
    expect(msg).toContain("Red Flags:");
    expect(msg).toContain("Urgency language");
    expect(msg).toContain("Type: phishing");
  });

  it("limits red flags to 5", () => {
    const flags = Array.from({ length: 10 }, (_, i) => `Flag ${i + 1}`);
    const msg = toMessengerMessage(makeResult({ redFlags: flags }));
    expect(msg).toContain("Flag 5");
    expect(msg).not.toContain("Flag 6");
  });

  it("limits next steps to 3", () => {
    const steps = Array.from({ length: 5 }, (_, i) => `Step ${i + 1}`);
    const msg = toMessengerMessage(makeResult({ nextSteps: steps }));
    expect(msg).toContain("Step 3");
    expect(msg).not.toContain("Step 4");
  });

  it("omits scamType when 'none'", () => {
    const msg = toMessengerMessage(makeResult({ scamType: "none" }));
    expect(msg).not.toContain("Type:");
  });

  it("renders a shopSignal commerce-flag chip when commerceFlags are present", () => {
    const msg = toMessengerMessage(
      makeResult({
        verdict: "SUSPICIOUS",
        redFlags: ["PayID payment requested", "Limited stock urgency"],
        shopSignal: {
          isCommerce: true,
          commerceFlags: ["payid-scam", "urgent-purchase-pressure"],
          generatedAt: "2026-05-19T09:00:00.000Z",
        },
      })
    );
    expect(msg).toContain("Shop signals:");
    expect(msg).toContain("payid-scam");
    expect(msg).toContain("urgent-purchase-pressure");
  });

  it("renders the bare 'online shop detected' line when commerceFlags is empty", () => {
    const msg = toMessengerMessage(
      makeResult({
        shopSignal: {
          isCommerce: true,
          commerceFlags: [],
          generatedAt: "2026-05-19T09:00:00.000Z",
        },
      })
    );
    expect(msg).toContain("Shop signals: online shop detected");
  });

  it("does not crash on an enriched shopSignal payload carrying paidProviderVerdict", () => {
    // Stage 0.5 adds an optional referrerSource field to ShopSignal so the
    // Stage-0 measurement window can count mobile-share share of
    // commerce-flagged volume. The formatter is not expected to render
    // referrerSource or paidProviderVerdict at this stage —
    // it just needs to keep emitting the existing shop-signals line
    // without throwing on the enriched payload shape.
    const msg = toMessengerMessage(
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
            trustScore: 48,
            blacklistDetections: 1,
            flags: ["suspicious-domain"],
            checkedAt: "2026-05-20T09:00:00.000Z",
          },
        },
      })
    );
    expect(msg).toContain("Shop signals:");
    expect(msg).toContain("payid-scam");
  });

  it("omits the shop-signals line entirely when shopSignal is absent", () => {
    const msg = toMessengerMessage(makeResult());
    expect(msg).not.toContain("Shop signals");
  });
});
