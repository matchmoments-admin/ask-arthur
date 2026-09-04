/**
 * The actions map is the advice half of Arthur's Take. It is curated rather
 * than generated precisely so it can be tested — these assertions are the
 * review that a model's output would never get.
 */
import { describe, expect, it } from "vitest";

import {
  actionsForTake,
  INTERNATIONAL_ACTIONS,
  type IntentLabel,
} from "@/lib/arthurs-take/actions";
import {
  ACTION_ESAFETY,
  ACTION_SCAMWATCH,
  IDCARE_PHONE,
} from "@/lib/onward/destinations";

const ALL_LABELS: IntentLabel[] = [
  "phishing",
  "romance_scam",
  "investment_fraud",
  "tech_support",
  "impersonation",
  "shopping_scam",
  "phone_scam",
  "email_scam",
  "sms_scam",
  "employment_scam",
  "advance_fee",
  "rental_scam",
  "sextortion",
  "informational",
  "other",
];

describe("actionsForTake", () => {
  it("returns actions for every label in the taxonomy", () => {
    // A missing key would render an empty actions panel rather than throw,
    // which is the kind of gap nobody notices in review.
    for (const label of ALL_LABELS) {
      expect(actionsForTake(label).length, label).toBeGreaterThan(0);
    }
  });

  it("always offers a reporting route somewhere in the world", () => {
    // The corpus is ~98% non-Australian. An AU-only actions panel would be
    // useless to almost every reader of this feed.
    for (const label of ALL_LABELS) {
      const intl = actionsForTake(label).filter(
        (a) => a.region === "international",
      );
      expect(intl.length, label).toBeGreaterThanOrEqual(1);
    }
  });

  it("routes sextortion to eSafety rather than the consumer-fraud channel", () => {
    // The need here is content removal and support, not scam intelligence.
    const actions = actionsForTake("sextortion");
    expect(actions.some((a) => a.href === ACTION_ESAFETY.value)).toBe(true);
    expect(actions.some((a) => a.href === ACTION_SCAMWATCH.value)).toBe(false);
  });

  it("never tells a sextortion reader to pay", () => {
    const text = actionsForTake("sextortion")
      .map((a) => `${a.label} ${a.description}`)
      .join(" ")
      .toLowerCase();
    expect(text).toContain("do not pay");
    expect(text).toContain("not done anything wrong");
  });

  it("leads money-loss reporting with the bank, the only step with a deadline", () => {
    for (const label of [
      "investment_fraud",
      "advance_fee",
      "shopping_scam",
      "rental_scam",
    ] as IntentLabel[]) {
      const reporting = actionsForTake(label).filter(
        (a) => a.kind === "reporting" && a.region === "AU",
      );
      expect(reporting[0]?.label, label).toMatch(/bank/i);
    }
  });

  it("separates advice from reporting so the UI can group them", () => {
    // region alone does not carry this: checking an ASIC licence is AU-specific
    // AND protective, so a region filter would mix advice into the reporting
    // list — which is how the first version of this map read.
    const actions = actionsForTake("investment_fraud");
    expect(actions.some((a) => a.kind === "protective")).toBe(true);
    expect(actions.some((a) => a.kind === "reporting")).toBe(true);
    const asic = actions.find((a) => a.href?.includes("asic.gov.au"));
    expect(asic?.kind).toBe("protective");
    expect(asic?.region).toBe("AU");
  });

  it("returns only protective advice when the take says this is not a scam", () => {
    // "Report this scam" under a take that says it is not one is incoherent.
    const actions = actionsForTake("phishing", { isScamReport: false });
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.kind === "protective")).toBe(true);
    expect(actions.some((a) => /report to/i.test(a.label))).toBe(false);
  });

  it("does not re-declare destinations that live in the onward module", () => {
    // Guards the single-source-of-truth rule: a second copy of the IDCARE
    // number here would drift from the one the reporting flow uses.
    const source = actionsForTake("phishing")
      .map((a) => `${a.label} ${a.description} ${a.href ?? ""}`)
      .join(" ");
    // IDCARE is a `call` action, so its number is not rendered as an href —
    // it must come through the imported constant, not a literal.
    expect(IDCARE_PHONE).toBe("1800 595 160");
    expect(source).not.toContain("1800 595 160");
  });

  it("keeps every international destination on https", () => {
    for (const action of INTERNATIONAL_ACTIONS) {
      expect(action.href, action.label).toMatch(/^https:\/\//);
    }
  });

  it("phrases advice about the pattern, never about the poster", () => {
    // The disclaimer says the take is not a judgment about the person who
    // posted. Accusatory advice would contradict it on the same screen.
    const accusation = /you (?:were|have been|got) (?:scammed|conned|duped)/i;
    for (const label of ALL_LABELS) {
      for (const action of actionsForTake(label)) {
        expect(
          accusation.test(`${action.label} ${action.description}`),
          `${label}: ${action.label}`,
        ).toBe(false);
      }
    }
  });
});
