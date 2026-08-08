import { describe, expect, it } from "vitest";
import { brandNormalize } from "@askarthur/shopfront-glue";

// #953. The onboarding route's correctness rests on two things: the join key
// must come from the CANONICAL normaliser (a local re-implementation would
// silently mismatch the SQL brand_normalize() and match nothing), and the
// domain shape must be validated before insert.

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

describe("brand join key", () => {
  it("matches the SQL contract: lowercase, strip non-alphanumerics", () => {
    expect(brandNormalize("Airwallex")).toBe("airwallex");
    expect(brandNormalize("Target Australia")).toBe("targetaustralia");
    expect(brandNormalize("iiNet")).toBe("iinet");
    expect(brandNormalize("Reece Pty. Ltd.")).toBe("reeceptyltd");
  });

  it("returns null for names that would create a dead row", () => {
    expect(brandNormalize("   ")).toBeNull();
    expect(brandNormalize("!!!")).toBeNull();
    expect(brandNormalize("")).toBeNull();
  });
});

describe("legitimate-domain validation", () => {
  it("accepts real domains including .com.au", () => {
    for (const d of ["airwallex.com", "target.com.au", "hellostake.com", "iinet.net.au"]) {
      expect(DOMAIN.test(d), d).toBe(true);
    }
  });

  it("rejects URLs, paths, spaces and bare words", () => {
    for (const d of ["https://airwallex.com", "airwallex.com/login", "air wallex.com", "airwallex", "-bad.com", "bad-.com"]) {
      expect(DOMAIN.test(d), d).toBe(false);
    }
  });
});
