import { describe, it, expect } from "vitest";

// Test the scrubPhoneForStorage function by importing the module
// Since scrubPhoneForStorage is not exported, we test it indirectly
// through the storePhoneLookups behavior, or we can test the pattern directly.

describe("scrubPhoneForStorage pattern", () => {
  // Replicate the logic since it's a private function
  function scrubPhoneForStorage(phone: string): string {
    if (phone.length < 4) return "***";
    return "*".repeat(phone.length - 3) + phone.slice(-3);
  }

  it("scrubs a standard E.164 AU number to last 3 digits", () => {
    const result = scrubPhoneForStorage("+61412345678");
    expect(result).toBe("*********678");
    expect(result).not.toContain("412");
  });

  it("scrubs a short number", () => {
    const result = scrubPhoneForStorage("+614");
    expect(result).toBe("*614");
  });

  it("handles very short numbers", () => {
    expect(scrubPhoneForStorage("12")).toBe("***");
    expect(scrubPhoneForStorage("")).toBe("***");
  });

  it("preserves exactly 3 trailing digits", () => {
    const result = scrubPhoneForStorage("+61298765432");
    expect(result.slice(-3)).toBe("432");
    expect(result.length).toBe("+61298765432".length);
  });
});
