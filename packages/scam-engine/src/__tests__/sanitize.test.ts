import { describe, expect, it } from "vitest";

import { scrubPII, scrubPhoneForStorage } from "../sanitize";

describe("scrubPII", () => {
  describe("email", () => {
    it("redacts a standalone email", () => {
      // The post-scrub cleanup also collapses the word immediately before the
      // placeholder (treated as a possible username), so "contact " is consumed.
      expect(scrubPII("contact john.doe@example.com now")).toBe("[EMAIL] now");
    });

    it("redacts a display-name email and its name", () => {
      expect(scrubPII("from John Smith <john@example.com>")).toBe("from [EMAIL]");
    });

    it("redacts a username left attached to an [EMAIL] placeholder", () => {
      // Generic phone/other patterns can leave a bare username before [EMAIL];
      // the post-scrub cleanup collapses it.
      expect(scrubPII("jacobovers jacob@x.io")).toBe("[EMAIL]");
    });
  });

  describe("financial identifiers (must beat the generic phone pattern)", () => {
    it("redacts a credit card before the phone pattern eats it", () => {
      expect(scrubPII("card 4111 1111 1111 1111")).toBe("card [CARD]");
    });

    it("redacts a partial card reference", () => {
      expect(scrubPII("card ending 8279")).toBe("[CARD_REF]");
    });

    it("redacts an Australian BSB", () => {
      expect(scrubPII("BSB 062-000")).toBe("BSB [BSB]");
    });
  });

  describe("government identifiers", () => {
    it("redacts a Medicare number", () => {
      expect(scrubPII("medicare 2123 45670 1")).toBe("medicare [MEDICARE]");
    });

    it("redacts a TFN", () => {
      expect(scrubPII("tfn 123 456 789")).toBe("tfn [TFN]");
    });

    it("redacts a US SSN", () => {
      expect(scrubPII("ssn 123-45-6789")).toBe("ssn [SSN]");
    });
  });

  describe("phone numbers", () => {
    it("redacts an Australian mobile", () => {
      expect(scrubPII("call 0412 345 678")).toBe("call [AU_PHONE]");
    });

    it("redacts an Australian landline", () => {
      expect(scrubPII("ph 02 9876 5432")).toBe("ph [AU_PHONE]");
    });

    it("redacts a generic phone as a catch-all", () => {
      // The generic phone pattern's leading optional-whitespace group consumes
      // the space before the number.
      expect(scrubPII("dial 555 123 4567")).toBe("dial[PHONE]");
    });
  });

  describe("network and address", () => {
    it("redacts an IPv4 address", () => {
      expect(scrubPII("from 192.168.1.1 here")).toBe("from [IP] here");
    });

    it("redacts a street address", () => {
      expect(scrubPII("at 12 Smith Street today")).toBe("at [ADDRESS] today");
    });
  });

  describe("names after salutations", () => {
    it("redacts an all-caps first name after a greeting", () => {
      expect(scrubPII("Hi ANA, your account")).toBe("[NAME], your account");
    });

    it("redacts a title-case full name after Dear", () => {
      expect(scrubPII("Dear Jane Doe")).toBe("[NAME]");
    });
  });

  describe("safety", () => {
    it("leaves PII-free text untouched", () => {
      const text = "This looks like a phishing attempt asking you to verify your login.";
      expect(scrubPII(text)).toBe(text);
    });

    it("redacts multiple PII types in one pass", () => {
      const out = scrubPII("Email jane@x.com or call 0412 345 678 about card 4111 1111 1111 1111");
      expect(out).toContain("[EMAIL]");
      expect(out).toContain("[AU_PHONE]");
      expect(out).toContain("[CARD]");
      expect(out).not.toContain("jane@x.com");
      expect(out).not.toContain("4111");
    });
  });
});

describe("scrubPhoneForStorage", () => {
  it("keeps only the last 3 digits, masking the rest", () => {
    expect(scrubPhoneForStorage("+61412345678")).toBe("*********678");
  });

  it("returns *** for inputs shorter than 4 chars", () => {
    expect(scrubPhoneForStorage("12")).toBe("***");
    expect(scrubPhoneForStorage("")).toBe("***");
  });

  it("masks a 4-digit input down to its last 3", () => {
    expect(scrubPhoneForStorage("1234")).toBe("*234");
  });
});
