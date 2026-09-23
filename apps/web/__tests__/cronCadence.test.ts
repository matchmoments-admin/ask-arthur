import { describe, expect, it } from "vitest";
import { cronMaxGapMs, expectEveryFromCrons } from "@/lib/cron-cadence";

const H = 3_600_000;

describe("cronMaxGapMs", () => {
  it.each([
    [["30 */6 * * *"], 6 * H],
    [["0 9 * * *"], 24 * H],
    [["10 3,9,12,15,21 * * *"], 6 * H], // 21:10 → 03:10
    [["0 10 * * *", "0 22 * * *"], 12 * H],
    [["15 */3 * * *"], 3 * H],
    [["30 9 * * 0"], 7 * 24 * H],
    [["0 10 * * 7"], 7 * 24 * H], // 7 = Sunday
    [["0 9-17/4 * * 1-5"], 64 * H], // Fri 17:00 → Mon 09:00
  ])("%j → %d", (exprs, gap) => {
    expect(cronMaxGapMs(exprs)).toBe(gap);
  });

  it.each([
    "0 11 1 * *", // monthly: declare expectEvery explicitly
    "TZ=Australia/Sydney 0 */6 * * *",
    "0 25 * * *",
    "0 L * * *",
  ])("refuses %s rather than guess", (expr) => {
    expect(() => cronMaxGapMs([expr])).toThrow();
  });
});

describe("expectEveryFromCrons", () => {
  it("reproduces the hand-typed windows it replaces", () => {
    expect(expectEveryFromCrons(["30 */6 * * *"])).toBe(9 * H);
    expect(expectEveryFromCrons(["0 9 * * *"])).toBe(26 * H);
    expect(expectEveryFromCrons(["10 3,9,12,15,21 * * *"])).toBe(9 * H);
    expect(expectEveryFromCrons(["30 9 * * 0"])).toBe(8 * 24 * H);
  });
});
