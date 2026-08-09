import { describe, expect, it } from "vitest";
import { readCount, fmtCount, over } from "@/lib/dashboard/read-count";

// These cases are not hypothetical — they are the response shapes measured
// against prod on 2026-08-09 (see the table in lib/dashboard/read-count.ts).
// The middle one is the whole reason this module exists: a head-count against a
// table that does not exist comes back `count: null, error: null, status 204`,
// because a HEAD response has no body for supabase-js to parse an error from.
// Any guard that only checks `error` is blind to it, and `?? 0` then renders the
// failure as a confident, reassuring zero.

describe("readCount distinguishes 'measured zero' from 'not measured'", () => {
  it("a genuinely empty table is 0, not an error", () => {
    const errs: string[] = [];
    expect(readCount({ count: 0, error: null }, "x", errs)).toBe(0);
    expect(errs).toEqual([]);
  });

  it("THE TRAP: a failed head-count (count null, error null) is not a zero", () => {
    const errs: string[] = [];
    expect(readCount({ count: null, error: null }, "filed issues", errs)).toBeNull();
    expect(errs).toEqual(["filed issues"]);
  });

  it("an error with a null count is a failure", () => {
    const errs: string[] = [];
    expect(readCount({ count: null, error: { code: undefined } }, "y", errs)).toBeNull();
    expect(errs).toEqual(["y"]);
  });

  it("a real number passes through untouched", () => {
    const errs: string[] = [];
    expect(readCount({ count: 41, error: null }, "z", errs)).toBe(41);
    expect(errs).toEqual([]);
  });
});

describe("an unmeasured count never renders as a number or trips an alarm", () => {
  it("formats as an em dash, not 0", () => {
    expect(fmtCount(null)).toBe("—");
    expect(fmtCount(0)).toBe("0");
    expect(fmtCount(1234)).toBe("1,234");
  });

  it("over() is false for unknown — an unknown value must not raise a false alarm", () => {
    expect(over(null, 100)).toBe(false);
    expect(over(101, 100)).toBe(true);
    expect(over(100, 100)).toBe(false);
  });

  it("over() being false for null is NOT the same as the value being safe — callers must render the unknown state (fmtCount) rather than treat it as passing", () => {
    // Documents the contract: over() answers "did we measure a breach?", not
    // "is everything fine?". The band + em dash carry the unknown case.
    expect(over(null, 0)).toBe(false);
    expect(fmtCount(null)).toBe("—");
  });
});
