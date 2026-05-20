import { describe, it, expect } from "vitest";
import { toWhatsAppMessage } from "../format-whatsapp";
import type { AnalysisResult } from "@askarthur/types";

const makeResult = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
  verdict: "SUSPICIOUS",
  confidence: 0.75,
  summary: "This message has some suspicious elements.",
  redFlags: ["Unusual sender", "Requests urgent action"],
  nextSteps: ["Do not click any links.", "Verify with the sender."],
  ...overrides,
});

describe("toWhatsAppMessage", () => {
  it("formats with WhatsApp bold markers", () => {
    const msg = toWhatsAppMessage(makeResult());
    expect(msg).toContain("*Verdict: Suspicious*");
    expect(msg).toContain("75% confidence");
    expect(msg).toContain("*Red Flags:*");
    expect(msg).toContain("*What to do:*");
  });

  it("includes summary text", () => {
    const msg = toWhatsAppMessage(makeResult());
    expect(msg).toContain("This message has some suspicious elements.");
  });

  it("includes footer", () => {
    const msg = toWhatsAppMessage(makeResult());
    expect(msg).toContain("_Powered by Ask Arthur");
  });

  it("does not crash on an enriched shopSignal payload carrying paidProviderVerdict", () => {
    // Stage 0.5 wires in-app-browser referrer through onto the ShopSignal
    // payload; the formatter must keep working without rendering the new
    // fields.
    const msg = toWhatsAppMessage(
      makeResult({
        verdict: "HIGH_RISK",
        redFlags: ["Domain renewal invoice scam"],
        shopSignal: {
          isCommerce: true,
          commerceFlags: ["domain-renewal-invoice"],
          generatedAt: "2026-05-19T09:00:00.000Z",
          referrerSource: "instagram-inapp",
          paidProviderVerdict: {
            provider: "apivoid",
            verdict: "risky",
            trustScore: 18,
            blacklistDetections: 2,
            flags: ["domain-blacklisted"],
            checkedAt: "2026-05-20T09:00:00.000Z",
          },
        },
      })
    );
    expect(msg).toContain("Shop signals:");
    expect(msg).toContain("domain-renewal-invoice");
  });
});
