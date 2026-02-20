import { describe, it, expect } from "vitest";
import {
  normalizePhoneE164,
  normalizeEmail,
  extractEmailDomain,
  isValidPhoneFormat,
  isValidEmailFormat,
} from "@/lib/phoneNormalize";
import { hashIdentifier } from "@/lib/hash";

// ─── Phone Normalization ───

describe("normalizePhoneE164", () => {
  it("normalizes AU mobile number (04xx format)", () => {
    expect(normalizePhoneE164("0412 345 678")).toBe("+61412345678");
  });

  it("normalizes AU mobile with dots and dashes", () => {
    expect(normalizePhoneE164("0412.345.678")).toBe("+61412345678");
    expect(normalizePhoneE164("0412-345-678")).toBe("+61412345678");
  });

  it("normalizes AU landline (02 format)", () => {
    expect(normalizePhoneE164("02 8233 4342")).toBe("+61282334342");
  });

  it("normalizes AU landline (03 format)", () => {
    expect(normalizePhoneE164("(03) 9876 5432")).toBe("+61398765432");
  });

  it("passes through valid E.164 numbers", () => {
    expect(normalizePhoneE164("+61412345678")).toBe("+61412345678");
  });

  it("normalizes AU numbers with country code but no +", () => {
    expect(normalizePhoneE164("61412345678")).toBe("+61412345678");
  });

  it("returns null for short codes (13/1300/1800)", () => {
    expect(normalizePhoneE164("131234")).toBeNull();
    expect(normalizePhoneE164("1300 123 456")).toBeNull();
    expect(normalizePhoneE164("1800 123 456")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(normalizePhoneE164("hello")).toBeNull();
    expect(normalizePhoneE164("123")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
  });

  it("normalizes AU 05xx mobile numbers", () => {
    expect(normalizePhoneE164("0512345678")).toBe("+61512345678");
  });

  it("normalizes 07 and 08 landlines", () => {
    expect(normalizePhoneE164("0712345678")).toBe("+61712345678");
    expect(normalizePhoneE164("0812345678")).toBe("+61812345678");
  });
});

// ─── Email Normalization ───

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Scam@FAKE.com  ")).toBe("scam@fake.com");
  });

  it("handles already normalized email", () => {
    expect(normalizeEmail("test@example.com")).toBe("test@example.com");
  });
});

describe("extractEmailDomain", () => {
  it("extracts domain from email", () => {
    expect(extractEmailDomain("scam@fake.com")).toBe("fake.com");
  });

  it("returns null for invalid email (no @)", () => {
    expect(extractEmailDomain("nodomain")).toBeNull();
  });
});

// ─── Validation ───

describe("isValidPhoneFormat", () => {
  it("accepts valid AU mobile", () => {
    expect(isValidPhoneFormat("0412345678")).toBe(true);
  });

  it("accepts valid E.164", () => {
    expect(isValidPhoneFormat("+61412345678")).toBe(true);
  });

  it("rejects invalid input", () => {
    expect(isValidPhoneFormat("abc")).toBe(false);
    expect(isValidPhoneFormat("123")).toBe(false);
  });

  it("rejects short codes", () => {
    expect(isValidPhoneFormat("131234")).toBe(false);
  });
});

describe("isValidEmailFormat", () => {
  it("accepts valid email", () => {
    expect(isValidEmailFormat("test@example.com")).toBe(true);
  });

  it("rejects invalid email", () => {
    expect(isValidEmailFormat("notanemail")).toBe(false);
    expect(isValidEmailFormat("@missing.com")).toBe(false);
    expect(isValidEmailFormat("test@")).toBe(false);
  });
});

// ─── Hash Utility ───

describe("hashIdentifier", () => {
  it("produces consistent hash for same input", async () => {
    const hash1 = await hashIdentifier("1.2.3.4", "Mozilla/5.0");
    const hash2 = await hashIdentifier("1.2.3.4", "Mozilla/5.0");
    expect(hash1).toBe(hash2);
  });

  it("produces different hash for different inputs", async () => {
    const hash1 = await hashIdentifier("1.2.3.4", "Mozilla/5.0");
    const hash2 = await hashIdentifier("5.6.7.8", "Mozilla/5.0");
    expect(hash1).not.toBe(hash2);
  });

  it("produces a 64-character hex string (SHA-256)", async () => {
    const hash = await hashIdentifier("1.2.3.4", "test-ua");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
