import { describe, expect, it } from "vitest";

import { domainAgeDays } from "../providers/donation-url";

describe("domainAgeDays", () => {
  it("returns null for invalid date strings", () => {
    expect(domainAgeDays("not a date")).toBeNull();
  });

  it("returns 0 (not negative) for future-dated WHOIS records", () => {
    // Some registrars return slightly-future creation dates due to
    // tz handling; clamp at 0 so the scoring logic doesn't misbehave.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(domainAgeDays(future)).toBe(0);
  });

  it("returns roughly the right age for a known date", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const age = domainAgeDays(tenDaysAgo);
    expect(age).not.toBeNull();
    // Floor + tz drift may give 9 or 10; both acceptable for the
    // <30d / 30-90d / 90+ banding.
    expect(age).toBeGreaterThanOrEqual(9);
    expect(age).toBeLessThanOrEqual(10);
  });

  it("returns >90 for an old domain", () => {
    expect(domainAgeDays("2020-01-01")).toBeGreaterThan(90);
  });
});
