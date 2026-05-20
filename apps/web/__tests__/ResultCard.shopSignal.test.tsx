import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import ResultCard from "../components/ResultCard";

type ResultCardProps = ComponentProps<typeof ResultCard>;

function renderResultCard(overrides: Partial<ResultCardProps> = {}): string {
  const props: ResultCardProps = {
    verdict: "SUSPICIOUS",
    confidence: 0.78,
    summary: "The shop has warning signs.",
    redFlags: ["Suspicious payment flow"],
    nextSteps: ["Do not pay until you verify the store."],
    shopSignal: {
      isCommerce: true,
      commerceFlags: ["fake-trust-badge"],
      generatedAt: "2026-05-20T06:00:00.000Z",
      paidProviderVerdict: {
        provider: "apivoid",
        verdict: "suspicious",
        trustScore: 52,
        blacklistDetections: 0,
        flags: ["no-valid-https"],
        checkedAt: "2026-05-20T06:01:00.000Z",
      },
    },
    ...overrides,
  };
  return renderToStaticMarkup(<ResultCard {...props} />);
}

describe("ResultCard Shop Signal paid-provider accordion", () => {
  it.each([
    ["SAFE", "safe"],
    ["UNCERTAIN", "suspicious"],
    ["SUSPICIOUS", "suspicious"],
    ["HIGH_RISK", "risky"],
  ] as const)(
    "renders when the result verdict is %s",
    (verdict, providerVerdict) => {
      const html = renderResultCard({
        verdict,
        shopSignal: {
          isCommerce: true,
          commerceFlags: [],
          generatedAt: "2026-05-20T06:00:00.000Z",
          paidProviderVerdict: {
            provider: "apivoid",
            verdict: providerVerdict,
            trustScore: providerVerdict === "safe" ? 88 : 41,
            blacklistDetections: providerVerdict === "risky" ? 3 : 0,
            flags: providerVerdict === "safe" ? [] : ["no-valid-https"],
            checkedAt: "2026-05-20T06:01:00.000Z",
          },
        },
      });

      expect(html).toContain("Paid shop check");
      expect(html).toContain("Trust score");
      expect(html).toContain("Blacklist hits");
    },
  );

  it("keeps the Stage-0 shop signal chip row when enriched data is present", () => {
    const html = renderResultCard();

    expect(html).toContain("Shop signals");
    expect(html).toContain("Fake trust badge");
    expect(html).toContain("Paid feed found warning signs");
  });

  it("does not render the accordion without paidProviderVerdict", () => {
    const html = renderResultCard({
      shopSignal: {
        isCommerce: true,
        commerceFlags: ["fake-trust-badge"],
        generatedAt: "2026-05-20T06:00:00.000Z",
      },
    });

    expect(html).toContain("Shop signals");
    expect(html).not.toContain("Paid shop check");
  });
});
