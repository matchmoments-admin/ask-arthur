import { describe, expect, it } from "vitest";
import { render } from "@react-email/components";
import SPFIntro from "../emails/nurture/SPFIntro";
import ReasonableSteps from "../emails/nurture/ReasonableSteps";
import CollectiveIntelligence from "../emails/nurture/CollectiveIntelligence";
import CaseStudy from "../emails/nurture/CaseStudy";
import TechnicalOverview from "../emails/nurture/TechnicalOverview";
import Deadline from "../emails/nurture/Deadline";

const TEMPLATES = [
  { name: "SPFIntro", T: SPFIntro, brief: "Brief 1 of 6" },
  { name: "ReasonableSteps", T: ReasonableSteps, brief: "Brief 2 of 6" },
  { name: "CollectiveIntelligence", T: CollectiveIntelligence, brief: "Brief 3 of 6" },
  { name: "CaseStudy", T: CaseStudy, brief: "Brief 4 of 6" },
  { name: "TechnicalOverview", T: TechnicalOverview, brief: "Brief 5 of 6" },
  { name: "Deadline", T: Deadline, brief: "Brief 6 of 6" },
] as const;

const PROPS = {
  name: "Acme Bank",
  unsubscribeUrl:
    "https://askarthur.au/unsubscribe?email=ops%40acme.example&token=abcd",
};

describe("nurture series shares EditorialBriefingLayout chrome", () => {
  for (const { name, T, brief } of TEMPLATES) {
    it(`${name} renders with briefing chrome + signed unsubscribe`, async () => {
      const html = await render(T(PROPS));
      // Chrome from the shared layout
      expect(html).toContain("ABN 72 695 772 313"); // footer brand block
      expect(html).toContain("#F8FAFC"); // tinted page bg
      expect(html).toContain("border-radius:12px 12px 0 0"); // header rounding
      expect(html).toContain("border-radius:0 0 12px 12px"); // footer rounding
      // Per-template eyebrow ties brief to the 6-step series
      expect(html).toContain(brief);
      // Signed unsubscribe URL threaded through
      expect(html).toContain("token=abcd");
      // Personalised greeting renders when name supplied
      expect(html).toContain("Acme Bank");
    });
  }

  it("SPFIntro leads with the penalty + deadline stats card", async () => {
    const html = await render(SPFIntro(PROPS));
    const ceilingAt = html.indexOf("AUD $52.7M");
    const principleAt = html.indexOf("six overarching principles");
    expect(ceilingAt).toBeGreaterThan(0);
    expect(principleAt).toBeGreaterThan(0);
    // Stats card must precede the principles section
    expect(ceilingAt).toBeLessThan(principleAt);
  });
});
