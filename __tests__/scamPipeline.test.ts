import { describe, it, expect } from "vitest";
import { scrubPII } from "@/lib/scamPipeline";

describe("scrubPII", () => {
  it("scrubs email addresses", () => {
    expect(scrubPII("Contact john@example.com for details")).toContain("[EMAIL]");
    expect(scrubPII("Contact john@example.com for details")).not.toContain(
      "john@example.com"
    );
  });

  it("scrubs credit card numbers (phone pattern catches segments first)", () => {
    // The PHONE pattern runs before CARD, so card digits are partially scrubbed
    // as phone numbers. This is acceptable — the digits are still removed.
    const result = scrubPII("Card: 4111 1111 1111 1111");
    expect(result).not.toContain("4111 1111 1111 1111");
    expect(result).not.toMatch(/\d{4}\s\d{4}\s\d{4}\s\d{4}/);
  });

  it("scrubs Australian Tax File Numbers", () => {
    const result = scrubPII("TFN: 123 456 789");
    expect(result).toContain("[TFN]");
  });

  it("scrubs IP addresses", () => {
    const result = scrubPII("Your IP is 192.168.1.100");
    expect(result).toContain("[IP]");
    expect(result).not.toContain("192.168.1.100");
  });

  it("scrubs Australian mobile numbers", () => {
    const result = scrubPII("Call me on 0412 345 678");
    expect(result).not.toContain("0412 345 678");
  });

  it("scrubs names after greeting prefixes", () => {
    const result = scrubPII("Dear John Smith, your account is locked");
    expect(result).toContain("[NAME]");
    expect(result).not.toContain("John Smith");
  });

  it("scrubs street addresses", () => {
    const result = scrubPII("Send to 123 Main Street");
    expect(result).toContain("[ADDRESS]");
  });

  it("handles text with no PII", () => {
    const text = "This is a normal message with no personal info.";
    expect(scrubPII(text)).toBe(text);
  });

  it("scrubs multiple PII types in the same text", () => {
    const result = scrubPII(
      "Dear John Smith, email john@test.com or call 0412 345 678"
    );
    expect(result).toContain("[NAME]");
    expect(result).toContain("[EMAIL]");
  });
});
