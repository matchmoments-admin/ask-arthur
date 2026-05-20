import { describe, expect, it } from "vitest";
import { charityResultToResultCardProps } from "@/lib/charityResultToResultCard";
import type { CharityCheckResult } from "@/components/CharityVerdict";

const pillar = {
  id: "test",
  score: 0,
  confidence: 0.8,
  available: false,
};

function makeResult(
  overrides: Partial<CharityCheckResult> = {},
): CharityCheckResult {
  return {
    verdict: "UNCERTAIN",
    composite_score: 50,
    explanation: "We could not fully verify this charity.",
    official_donation_url: null,
    generated_at: "2026-05-20T00:00:00.000Z",
    providers_used: [],
    coverage: {
      acnc: "disabled",
      abr: "disabled",
      donation_url: "disabled",
      pfra: "disabled",
    },
    pillars: {
      acnc_registration: pillar,
      abr_dgr: pillar,
      donation_url: pillar,
      pfra: pillar,
    },
    ...overrides,
  };
}

describe("charityResultToResultCardProps", () => {
  it("preserves the canonical UNCERTAIN verdict for ResultCard", () => {
    expect(charityResultToResultCardProps(makeResult()).verdict).toBe(
      "UNCERTAIN",
    );
  });
});
