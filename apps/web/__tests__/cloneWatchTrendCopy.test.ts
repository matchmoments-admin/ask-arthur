import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTrendDisclosure, LOOKALIKE_DOMAINS_UNIT } from "@/lib/clone-watch/targeting-copy";
import {
  describeTotalMove,
  methodChangeSentence,
  moverCopy,
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
    expect(describeTotalMove(m)).toBe("That's up 9 domains on July 2026 (3 → 12).");
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

  it("no three-month line across a matcher change (not the same measurement)", () => {
    const series = [
      { label: "Jun 2026", total: 664 },
      { label: "Jul 2026", total: 915 },
      { label: "Aug 2026", total: 855 },
    ];
    expect(threeMonthLine(mom({ series, methodChanged: true }))).toBe("");
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


/**
 * The matcher-change disclosure has ONE home: trend-copy methodChangeSentence
 * (PR-D, map #1224). buildTrendDisclosure used to carry a second wording, so
 * the caption said it twice; the edition page said it not at all.
 *
 * GO-RED: restoring the old claimable=0 sentence in buildTrendDisclosure fails
 * "the trend disclosure no longer restates it" (and the caption's said-once
 * test in cloneWatchCaption.test.ts); making methodChangeSentence return null
 * fails "trend-copy states it".
 */
describe("matcher change — said once, by trend-copy", () => {
  const exclusions = {
    claimable: 0,
    unchanged: 0,
    coverageStarted: 0,
    coverageEnded: 0,
    belowFloor: 100,
    unknown: 0,
    methodChanged: 40,
  };

  it("trend-copy states it, and describeTotalMove is that sentence", () => {
    const m = mom({ methodChanged: true, available: false });
    expect(methodChangeSentence(m)).toMatch(/not comparable/);
    expect(describeTotalMove(m)).toBe(methodChangeSentence(m));
    expect(methodChangeSentence(mom())).toBeNull();
  });

  it("the trend disclosure no longer restates it", () => {
    expect(buildTrendDisclosure(exclusions)).toBe("");
  });
});

/**
 * Biggest mover — one wording for the caption and the carousel slide.
 *
 * GO-RED: reverting the verb rule to the caption's old `>=` ("more than
 * double" at exactly 2×) fails "exactly double is 'doubled'"; the slide's old
 * "more than {jumped}" can no longer be written because the slide prints
 * `mover.verb` (pinned by the source check below — removing moverCopy from the
 * slide fails it).
 */
describe("moverCopy", () => {
  it("exactly double is 'doubled', not 'more than doubled'", () => {
    expect(moverCopy("Kmart", { priorClones: 10, clones: 20 }, LOOKALIKE_DOMAINS_UNIT).verb).toBe("doubled");
  });
  it("more than double is 'more than doubled'", () => {
    expect(moverCopy("Kmart", { priorClones: 10, clones: 21 }, LOOKALIKE_DOMAINS_UNIT).verb).toBe("more than doubled");
  });
  it("a rise short of 2× 'jumped' — never 'more than jumped'", () => {
    const c = moverCopy("Kmart", { priorClones: 30, clones: 45 }, LOOKALIKE_DOMAINS_UNIT);
    expect(c.verb).toBe("jumped");
    expect(`${c.sentence} ${c.lead}`).not.toMatch(/more than jumped/);
  });
  it("no actor attribution, and the scope of 'sharpest' is stated", () => {
    const c = moverCopy("Kmart", { priorClones: 30, clones: 45 }, LOOKALIKE_DOMAINS_UNIT);
    expect(`${c.sentence} ${c.lead}`).not.toMatch(/one actor|in bulk|campaign/i);
    expect(c.sentence).toContain("Australian brands we monitored for both months");
  });
  it("a v5 mover is worded in the card's unit, never 'lookalike domains' (#1262, D1)", () => {
    const c = moverCopy("Kmart", { priorClones: 10, clones: 21 }, "lookalikes");
    expect(c.sentence).toContain("its lookalikes more than doubled");
    expect(c.sentence).not.toMatch(/lookalike domains/);
  });
  it("the caption and the admin slide both word the mover through moverCopy", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    // #1262: the call also passes the card's per-brand unit noun (v5 movers
    // are targeting events), so pin the call shape up to that argument.
    expect(read("lib/clone-watch/clone-watch-caption.ts")).toMatch(/moverCopy\(spName, sp, perBrandUnitNoun\(card\.perBrandUnit\)\)\.sentence/);
    const slide = read("app/admin/report-card/page.tsx");
    expect(slide).toMatch(/moverCopy\(name, sp, perBrandUnitNoun\(data\.perBrandUnit\)\)/);
    expect(slide).not.toMatch(/more than \{/);
  });
});
