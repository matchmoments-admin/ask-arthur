import { describe, expect, it } from "vitest";
import { AnalyzeCompletedDataSchema } from "../inngest/events";

// v0.2e: charityIntent rides analyze.completed.v1 (shopSignal precedent) so
// the durable consumer persists it onto scam_reports.analysis_result and
// the weekly signal review can count charity-shaped inputs.

const base = {
  requestId: "req_12345678",
  source: "web" as const,
  verdict: "SUSPICIOUS" as const,
  confidence: 0.8,
  summary: "Looks like a charity impersonation.",
  redFlags: ["Unregistered charity name"],
  nextSteps: ["Check the ACNC register"],
  reporterHash: "abc123",
  region: null,
  countryCode: "AU",
  imageCount: 0,
  cacheHit: false,
  consumerFlags: {
    intelligenceCore: false,
    scamContactReporting: false,
    scamUrlReporting: false,
    phoneIntelligence: false,
  },
};

describe("AnalyzeCompletedDataSchema — charityIntent", () => {
  it("parses without charityIntent (field is optional)", () => {
    const parsed = AnalyzeCompletedDataSchema.parse(base);
    expect(parsed.charityIntent).toBeUndefined();
  });

  it("parses with a full charityIntent", () => {
    const parsed = AnalyzeCompletedDataSchema.parse({
      ...base,
      charityIntent: {
        extractedAbn: "11005357522",
        extractedName: "Australian Red Cross",
      },
    });
    expect(parsed.charityIntent?.extractedAbn).toBe("11005357522");
    expect(parsed.charityIntent?.extractedName).toBe("Australian Red Cross");
  });

  it("parses with a partial charityIntent (keyword-only detection)", () => {
    const parsed = AnalyzeCompletedDataSchema.parse({
      ...base,
      charityIntent: {},
    });
    expect(parsed.charityIntent).toEqual({});
  });
});
