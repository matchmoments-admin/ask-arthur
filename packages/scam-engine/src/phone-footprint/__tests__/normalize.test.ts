import { describe, it, expect, beforeAll } from "vitest";
import { hashMsisdn, hashIdentifierForPf, normalizePhoneE164 } from "../normalize";

// Tests for the Phone Footprint normalization + hashing primitives.
// Uses a fixed pepper so hash assertions are stable in CI.

beforeAll(() => {
  process.env.PHONE_FOOTPRINT_PEPPER = "test-pepper-deterministic";
});

describe("hashMsisdn", () => {
  it("produces the same hash for the same input (deterministic)", () => {
    const a = hashMsisdn("+61412345678");
    const b = hashMsisdn("+61412345678");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = hashMsisdn("+61412345678");
    const b = hashMsisdn("+61412345679");
    expect(a).not.toBe(b);
  });

  it("returns a 64-character hex string", () => {
    const h = hashMsisdn("+61412345678");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashIdentifierForPf", () => {
  it("namespaces hashes so ip and ua collisions are impossible", () => {
    // Same value, different prefix → different hash. Prevents an attacker
    // from crafting a UA that collides with a specific IP's hash.
    const ipHash = hashIdentifierForPf("ip", "203.0.113.5");
    const uaHash = hashIdentifierForPf("ua", "203.0.113.5");
    expect(ipHash).not.toBe(uaHash);
  });
});

describe("normalizePhoneE164 (re-export)", () => {
  it("normalizes common AU mobile formats to +61", () => {
    expect(normalizePhoneE164("0412 345 678")).toBe("+61412345678");
    expect(normalizePhoneE164("0412-345-678")).toBe("+61412345678");
    expect(normalizePhoneE164("+61412345678")).toBe("+61412345678");
  });

  it("returns null for 13/1300/1800 short codes", () => {
    expect(normalizePhoneE164("1300123456")).toBeNull();
    expect(normalizePhoneE164("132345")).toBeNull();
  });

  it("returns null for short / invalid inputs", () => {
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164("abc")).toBeNull();
  });
});
