import { describe, expect, it } from "vitest";
import {
  ClassificationOutputSchema,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "@/app/api/inngest/functions/clone-watch-haiku-preclassify";

describe("ClassificationOutputSchema", () => {
  it("accepts a fully-populated valid classification", () => {
    const parsed = ClassificationOutputSchema.parse({
      is_clone: true,
      confidence: 0.92,
      clone_tactic: "typosquat",
      attack_intent: "credential_phishing",
      risk_indicators: ["urgency_words", "login_form_url"],
      reason: "csrsales.com is a single-char typosquat of carsales.com.au.",
    });
    expect(parsed.is_clone).toBe(true);
    expect(parsed.confidence).toBe(0.92);
    expect(parsed.clone_tactic).toBe("typosquat");
    expect(parsed.attack_intent).toBe("credential_phishing");
    expect(parsed.risk_indicators).toEqual(["urgency_words", "login_form_url"]);
  });

  it("defaults risk_indicators to [] when omitted", () => {
    const parsed = ClassificationOutputSchema.parse({
      is_clone: false,
      confidence: 0.15,
      clone_tactic: "unrelated",
      attack_intent: "unknown",
      reason: "bondi.design is a Sydney suburb, no relation to Bonds clothing.",
    });
    expect(parsed.risk_indicators).toEqual([]);
  });

  it("rejects confidence outside [0,1]", () => {
    expect(() =>
      ClassificationOutputSchema.parse({
        is_clone: true,
        confidence: 1.5,
        clone_tactic: "typosquat",
        attack_intent: "credential_phishing",
        reason: "x",
      }),
    ).toThrow();
    expect(() =>
      ClassificationOutputSchema.parse({
        is_clone: false,
        confidence: -0.1,
        clone_tactic: "unrelated",
        attack_intent: "unknown",
        reason: "x",
      }),
    ).toThrow();
  });

  it("rejects invalid clone_tactic", () => {
    expect(() =>
      ClassificationOutputSchema.parse({
        is_clone: true,
        confidence: 0.5,
        clone_tactic: "unknown_tactic",
        attack_intent: "credential_phishing",
        reason: "x",
      }),
    ).toThrow();
  });

  it("rejects invalid attack_intent", () => {
    expect(() =>
      ClassificationOutputSchema.parse({
        is_clone: true,
        confidence: 0.5,
        clone_tactic: "typosquat",
        attack_intent: "nonsense",
        reason: "x",
      }),
    ).toThrow();
  });

  it("rejects unknown risk_indicators", () => {
    expect(() =>
      ClassificationOutputSchema.parse({
        is_clone: true,
        confidence: 0.5,
        clone_tactic: "typosquat",
        attack_intent: "credential_phishing",
        risk_indicators: ["xxxx_not_a_real_indicator"],
        reason: "x",
      }),
    ).toThrow();
  });

  it("rejects empty reason", () => {
    expect(() =>
      ClassificationOutputSchema.parse({
        is_clone: true,
        confidence: 0.5,
        clone_tactic: "typosquat",
        attack_intent: "credential_phishing",
        reason: "",
      }),
    ).toThrow();
  });

  it("caps reason length at 500 chars", () => {
    expect(() =>
      ClassificationOutputSchema.parse({
        is_clone: true,
        confidence: 0.5,
        clone_tactic: "typosquat",
        attack_intent: "credential_phishing",
        reason: "x".repeat(501),
      }),
    ).toThrow();
  });
});

describe("PROMPT_VERSION", () => {
  it("is a non-empty string (versions get persisted to the DB row)", () => {
    expect(typeof PROMPT_VERSION).toBe("string");
    expect(PROMPT_VERSION.length).toBeGreaterThan(0);
  });
});

describe("SYSTEM_PROMPT", () => {
  it("describes all 4 dimensions the schema enforces", () => {
    expect(SYSTEM_PROMPT).toContain("IS_CLONE");
    expect(SYSTEM_PROMPT).toContain("CLONE_TACTIC");
    expect(SYSTEM_PROMPT).toContain("ATTACK_INTENT");
    expect(SYSTEM_PROMPT).toContain("RISK_INDICATORS");
  });

  it("lists every clone_tactic enum value", () => {
    const tactics = [
      "typosquat",
      "homograph",
      "brandjack",
      "lookalike_tld",
      "subdomain_abuse",
      "compound_word",
      "unrelated",
      "parked",
      "other",
    ];
    for (const t of tactics) {
      expect(SYSTEM_PROMPT).toContain(t);
    }
  });

  it("lists every attack_intent enum value", () => {
    const intents = [
      "credential_phishing",
      "payment_fraud",
      "malware_delivery",
      "investment_scam",
      "fake_marketplace",
      "crypto_scam",
      "support_scam",
      "unknown",
    ];
    for (const i of intents) {
      expect(SYSTEM_PROMPT).toContain(i);
    }
  });
});
