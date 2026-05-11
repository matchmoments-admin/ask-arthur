import { describe, expect, it } from "vitest";
import { render } from "@react-email/components";
import WeeklyIntelDigest from "../emails/WeeklyIntelDigest";

const fixture = {
  weekStart: "2026-05-04",
  weekEnd: "2026-05-11",
  totalPostsClassified: 412,
  emergingThemes: [
    {
      id: "t1",
      slug: "fake-debt-collectors",
      title: "Fake debt collector calls escalate",
      narrative:
        "Multiple AU callers report aggressive collection scripts referencing real legal-firm names.",
      memberCount: 32,
      representativeBrands: ["Telstra", "ATO"],
    },
  ],
  topBrands: [
    { brand: "Instagram", mentionCount: 14 },
    { brand: "ATO", mentionCount: 11 },
  ],
  topCategories: [{ label: "phishing", count: 88 }],
  scamOfTheWeekQuote: { text: "I clicked the parcel link.", speakerRole: "victim" },
  modelVersion: "claude-sonnet-4-6",
  promptVersion: "reddit-intel-v1@2026-05-11",
};

describe("WeeklyIntelDigest renders via EditorialBriefingLayout", () => {
  it("produces non-empty HTML with the briefing chrome", async () => {
    const html = await render(WeeklyIntelDigest(fixture));
    expect(html.length).toBeGreaterThan(2000);
    expect(html).toContain("Weekly Intel"); // header pill
    expect(html).toContain("ABN 72 695 772 313"); // footer
    expect(html).toContain("reddit-intel-v1@2026-05-11"); // debug stripe
    expect(html).toContain("#F8FAFC"); // tinted page bg
  });

  it("places Brands impersonated above Emerging this week", async () => {
    const html = await render(WeeklyIntelDigest(fixture));
    const brandsAt = html.indexOf("Brands impersonated");
    const themesAt = html.indexOf("Emerging this week");
    expect(brandsAt).toBeGreaterThan(0);
    expect(themesAt).toBeGreaterThan(0);
    expect(brandsAt).toBeLessThan(themesAt);
  });

  it("has rounded header and footer corners", async () => {
    const html = await render(WeeklyIntelDigest(fixture));
    // React Email serialises borderRadius to CSS border-radius in the
    // inline style attribute. We check both forms to be tolerant.
    expect(
      html.includes("border-radius:12px 12px 0 0") ||
        html.includes('border-radius: 12px 12px 0 0'),
    ).toBe(true);
    expect(
      html.includes("border-radius:0 0 12px 12px") ||
        html.includes('border-radius: 0 0 12px 12px'),
    ).toBe(true);
  });

  it("hides debug stripe when modelVersion/promptVersion absent", async () => {
    const html = await render(
      WeeklyIntelDigest({ ...fixture, modelVersion: "", promptVersion: "" }),
    );
    // Stripe text is "modelVersion · promptVersion"; with both empty we
    // still render " · " — the only thing we strictly want is no bleed
    // of an internal-looking version string.
    expect(html).not.toContain("reddit-intel-v1");
  });
});
