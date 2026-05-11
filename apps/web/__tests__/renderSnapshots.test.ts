// Run-on-demand snapshot dumper: renders each email to /tmp so the
// designer (or you, in a browser) can eyeball the layout outside of
// the inbox. Not part of CI; invoke with:
//   pnpm exec vitest run __tests__/render-snapshots.fixture.ts
//
// Outputs:
//   /tmp/email-snapshots/{template}.html
//
// Skipped by default in CI via `process.env.SNAPSHOT_EMAILS`.
import { describe, it } from "vitest";
import { render } from "@react-email/components";
import { mkdir, writeFile } from "fs/promises";
import SPFIntro from "../emails/nurture/SPFIntro";
import ReasonableSteps from "../emails/nurture/ReasonableSteps";
import CollectiveIntelligence from "../emails/nurture/CollectiveIntelligence";
import CaseStudy from "../emails/nurture/CaseStudy";
import TechnicalOverview from "../emails/nurture/TechnicalOverview";
import Deadline from "../emails/nurture/Deadline";
import WeeklyIntelDigest from "../emails/WeeklyIntelDigest";

const skip = !process.env.SNAPSHOT_EMAILS;
const out = "/tmp/email-snapshots";

const NURTURE_PROPS = {
  name: "Acme Bank",
  unsubscribeUrl: "https://askarthur.au/unsubscribe?email=preview&token=demo",
};

const INTEL_FIXTURE = {
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
    {
      id: "t2",
      slug: "tinder-snapchat-sextortion",
      title: "Tinder-to-Snapchat sextortion",
      narrative:
        "Match conversations migrate to Snapchat where image exchange triggers extortion.",
      memberCount: 19,
      representativeBrands: ["Tinder", "Snapchat"],
    },
  ],
  topBrands: [
    { brand: "Instagram", mentionCount: 14 },
    { brand: "ATO", mentionCount: 11 },
    { brand: "Telstra", mentionCount: 9 },
  ],
  topCategories: [
    { label: "phishing", count: 88 },
    { label: "romance_scam", count: 64 },
  ],
  scamOfTheWeekQuote: {
    text: "I clicked the parcel link before I even thought about it.",
    speakerRole: "victim",
  },
  modelVersion: "claude-sonnet-4-6",
  promptVersion: "reddit-intel-v1@2026-05-11",
};

describe.skipIf(skip)("email snapshots", () => {
  it("dumps every template to /tmp/email-snapshots/", async () => {
    await mkdir(out, { recursive: true });

    const renders: Array<[string, string]> = [
      ["WeeklyIntelDigest", await render(WeeklyIntelDigest(INTEL_FIXTURE))],
      ["nurture-1-SPFIntro", await render(SPFIntro(NURTURE_PROPS))],
      ["nurture-2-ReasonableSteps", await render(ReasonableSteps(NURTURE_PROPS))],
      ["nurture-3-CollectiveIntelligence", await render(CollectiveIntelligence(NURTURE_PROPS))],
      ["nurture-4-CaseStudy", await render(CaseStudy(NURTURE_PROPS))],
      ["nurture-5-TechnicalOverview", await render(TechnicalOverview(NURTURE_PROPS))],
      ["nurture-6-Deadline", await render(Deadline(NURTURE_PROPS))],
    ];

    for (const [name, html] of renders) {
      await writeFile(`${out}/${name}.html`, html, "utf8");
    }
  });
});
