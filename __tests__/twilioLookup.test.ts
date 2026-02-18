import { describe, it, expect } from "vitest";
import { extractPhoneNumbers } from "@/lib/twilioLookup";

describe("extractPhoneNumbers", () => {
  it("extracts AU mobile numbers (0412 345 678)", () => {
    const results = extractPhoneNumbers("Call me on 0412 345 678 please");
    expect(results).toHaveLength(1);
    expect(results[0].original).toBe("0412 345 678");
    expect(results[0].e164).toBe("+61412345678");
  });

  it("extracts international format (+61412345678)", () => {
    const results = extractPhoneNumbers("Number is +61412345678");
    expect(results).toHaveLength(1);
    expect(results[0].e164).toBe("+61412345678");
  });

  it("extracts AU landline numbers ((02) 9876 5432)", () => {
    const results = extractPhoneNumbers("Office: (02) 9876 5432");
    expect(results).toHaveLength(1);
    // Regex captures from the digit after optional paren
    expect(results[0].e164).toBe("+61298765432");
  });

  it("extracts 1300 numbers without E.164", () => {
    const results = extractPhoneNumbers("Call 1300 123 456 for support");
    expect(results).toHaveLength(1);
    expect(results[0].original).toBe("1300 123 456");
    expect(results[0].e164).toBeNull(); // 1300 numbers can't be looked up via Twilio
  });

  it("extracts 1800 numbers without E.164", () => {
    const results = extractPhoneNumbers("Free call 1800 555 123");
    expect(results).toHaveLength(1);
    expect(results[0].e164).toBeNull();
  });

  it("extracts multiple numbers and deduplicates", () => {
    const transcript = `
      Call 0412 345 678 or 0412 345 678 for more info.
      Also try (03) 9876 5432.
    `;
    const results = extractPhoneNumbers(transcript);
    // Should have 2 unique numbers, not 3
    expect(results.length).toBe(2);
  });

  it("handles numbers with dashes", () => {
    const results = extractPhoneNumbers("Phone: 0412-345-678");
    expect(results).toHaveLength(1);
    expect(results[0].e164).toBe("+61412345678");
  });

  it("handles numbers with dots", () => {
    const results = extractPhoneNumbers("Phone: 0412.345.678");
    expect(results).toHaveLength(1);
    expect(results[0].e164).toBe("+61412345678");
  });

  it("returns empty array for text with no phone numbers", () => {
    const results = extractPhoneNumbers("Hello, this is a normal message.");
    expect(results).toHaveLength(0);
  });

  it("handles 05xx mobile numbers", () => {
    const results = extractPhoneNumbers("New number: 0512 345 678");
    expect(results).toHaveLength(1);
    expect(results[0].e164).toBe("+61512345678");
  });

  it("caps extraction — handles many numbers in a transcript", () => {
    const numbers = Array.from({ length: 10 }, (_, i) =>
      `041${i} 000 00${i}`
    ).join(", ");
    const results = extractPhoneNumbers(numbers);
    // All unique numbers should be extracted (cap is applied at lookup, not extraction)
    expect(results.length).toBeGreaterThan(0);
  });
});
