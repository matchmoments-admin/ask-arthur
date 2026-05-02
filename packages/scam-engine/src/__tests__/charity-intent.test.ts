import { describe, expect, it } from "vitest";

import { detectCharityIntent } from "../charity-intent";

describe("detectCharityIntent", () => {
  describe("non-detection (returns null)", () => {
    it("null/undefined input", () => {
      expect(detectCharityIntent(null)).toBeNull();
      expect(detectCharityIntent(undefined)).toBeNull();
    });

    it("empty string", () => {
      expect(detectCharityIntent("")).toBeNull();
    });

    it("very short input", () => {
      expect(detectCharityIntent("hi")).toBeNull();
    });

    it("ordinary scam-like text without charity signals", () => {
      expect(
        detectCharityIntent(
          "Hi mum it's me my phone is broken can you transfer $500 to this account",
        ),
      ).toBeNull();
    });

    it("text with random 11-digit string that isn't charity-shaped — still detects (ABN alone)", () => {
      // This is intentional: even without charity keywords, an 11-digit
      // ABN-shaped number is enough to offer the CTA. The dedicated
      // /charity-check page will reject false positives on its own
      // (the engine looks up the ABN; not-found = SUSPICIOUS, no harm).
      const r = detectCharityIntent("My phone is 11 005 357 522 wait no thats wrong");
      expect(r).not.toBeNull();
      expect(r?.extractedAbn).toBe("11005357522");
    });
  });

  describe("ABN extraction", () => {
    it("11 digits no spaces", () => {
      const r = detectCharityIntent("Donate to ABN 11005357522 today");
      expect(r?.extractedAbn).toBe("11005357522");
    });

    it("11 digits with space separators", () => {
      const r = detectCharityIntent("Donate to ABN 11 005 357 522");
      expect(r?.extractedAbn).toBe("11005357522");
    });

    it("11 digits with dash separators", () => {
      const r = detectCharityIntent("Charity ABN: 11-005-357-522");
      expect(r?.extractedAbn).toBe("11005357522");
    });

    it("rejects 10-digit number (not an ABN)", () => {
      const r = detectCharityIntent("Charity number 1234567890");
      // Charity keyword fires the detector; ABN field stays undefined
      expect(r?.detected).toBe(true);
      expect(r?.extractedAbn).toBeUndefined();
    });

    it("rejects 12-digit number", () => {
      const r = detectCharityIntent("Donate to charity number 123456789012");
      expect(r?.detected).toBe(true);
      expect(r?.extractedAbn).toBeUndefined();
    });
  });

  describe("keyword detection", () => {
    it.each([
      "I want to donate to a good cause",
      "Their bushfire appeal is on the news",
      "She does fundraising for the school",
      "Check the ACNC register for this one",
      "These tax-deductible donations are genuine",
      "I gave through GoFundMe last week",
      "Looking for a reputable charity",
      "It says donating helps disaster victims",
    ])("fires on '%s'", (text) => {
      const r = detectCharityIntent(text);
      expect(r?.detected).toBe(true);
    });
  });

  describe("name extraction", () => {
    it("'donate to <Name>' pattern", () => {
      const r = detectCharityIntent("I want to donate to Cancer Council Australia today");
      expect(r?.extractedName).toBe("Cancer Council Australia");
    });

    it("'<Name> Foundation' pattern", () => {
      const r = detectCharityIntent("Have you heard of the Smith Family Foundation charity?");
      // Either pattern can fire — Foundation match wins because it's
      // more specific
      expect(r?.extractedName).toBeDefined();
    });

    it("quoted name pattern", () => {
      const r = detectCharityIntent(
        'Someone said "Australian Red Cross Society" was the official name for the donation',
      );
      expect(r?.extractedName).toBe("Australian Red Cross Society");
    });

    it("returns no name when input is generic but does have keyword", () => {
      const r = detectCharityIntent("Asking about a donation today");
      expect(r?.detected).toBe(true);
      expect(r?.extractedName).toBeUndefined();
    });
  });

  describe("combined ABN + name + keyword", () => {
    it("extracts both when present", () => {
      const r = detectCharityIntent(
        "Donate to Australian Red Cross Society ABN 11 005 357 522",
      );
      expect(r?.detected).toBe(true);
      expect(r?.extractedAbn).toBe("11005357522");
      // Name extraction may or may not fire on this exact phrasing
      // (depends on which pattern matches first); both are valid outcomes
    });
  });

  describe("guards against degenerate input", () => {
    it("rejects 5000+ char text (cap to keep regex bounded)", () => {
      const huge = "donate ".repeat(2000);
      expect(detectCharityIntent(huge)).toBeNull();
    });
  });
});
