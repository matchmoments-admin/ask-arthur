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
    expect(msg).toContain("*Verdict: SUSPICIOUS*");
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
});
