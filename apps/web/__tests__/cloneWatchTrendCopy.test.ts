import { describe, expect, it } from "vitest";
import {
  describeTotalMove,
  shortTotalMove,
  threeMonthLine,
  totalMove,
  type MomLike,
} from "@/lib/clone-watch/trend-copy";

/**
 * trend-copy.ts — the ONE wording of "more or less than last month" (#1226).
 *
 * Go-red record:
 *   - "noise is about the same": drop the `noise` branch in totalMove → the
 *     804 → 850 month reads "up 6%".
 *   - "older rows are judged by the same rule": make `mom.noise ?? …` read
 *     `mom.noise ?? false` → a pre-#1226 row with a 2-domain move reads "up".
 */
const mom = (over: Partial<MomLike> = {}): MomLike => ({
  available: true,
  priorLabel: "July 2026",
  priorTotal: 804,
  totalDelta: 96,
  totalPct: 12,
  ...over,
});

describe("trend-copy", () => {
  it("states a real move with its percentage", () => {
    expect(describeTotalMove(mom({ noise: false }))).toBe("That's up 12% on July 2026 (804 → 900).");
    expect(shortTotalMove(mom({ noise: false }))).toBe("+96 (+12%) vs July 2026");
  });

  it("noise is about the same, however it would have printed", () => {
    const m = mom({ totalDelta: 46, totalPct: 6, noise: true });
    expect(totalMove(m).kind).toBe("same");
    expect(describeTotalMove(m)).toContain("about the same as July 2026 (804 → 850)");
    expect(shortTotalMove(m)).toBe("about the same as July 2026");
  });

  it("older rows (no `noise` field) are judged by the same rule from their numbers", () => {
    expect(totalMove(mom({ totalDelta: 2, totalPct: 0 })).kind).toBe("same");
    expect(totalMove(mom()).kind).toBe("up"); // 804 → 900 is 2.3σ
  });

  it("prints the absolute change when there is no percentage (below the floor)", () => {
    const m = mom({ priorTotal: 3, totalDelta: 9, totalPct: null, noise: false });
    expect(describeTotalMove(m)).toBe("That's up 9 on July 2026 (3 → 12).");
  });

  it("says nothing comparative across a matcher change", () => {
    const m = mom({ methodChanged: true, available: false });
    expect(describeTotalMove(m)).toMatch(/not comparable/);
    expect(shortTotalMove(m)).toBeNull();
  });

  it("returns null with no prior month, so the caller's baseline copy applies", () => {
    expect(describeTotalMove(mom({ available: false }))).toBeNull();
  });

  it("always states a feed-volume shift beside the delta", () => {
    const m = mom({ noise: false, feedShift: { priorSwept: 2_100_000, currentSwept: 1_400_000, pct: -33 } });
    expect(describeTotalMove(m)).toContain("feed we sweep was 33% smaller than in July 2026");
  });

  it("three-month line only from published months", () => {
    const series = [
      { label: "Jun 2026", total: 664 },
      { label: "Jul 2026", total: 915 },
      { label: "Aug 2026", total: 855 },
    ];
    expect(threeMonthLine(mom({ series }))).toBe("Jun 2026 664 → Jul 2026 915 → Aug 2026 855");
    expect(threeMonthLine(mom({ series: [{ label: "Jun 2026", total: null }, ...series.slice(1)] }))).toBe("");
  });
});
