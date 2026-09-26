import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchNetcraftSubmissionUrls,
  isSubmissionProcessing,
} from "@/lib/clone-watch/netcraft-urls";
import {
  formatDurationMinutes,
  parseTakedownStats,
  publishableMedian,
} from "@/lib/clone-watch/takedown-stats";
import { buildVendorGapPage, defang } from "@/lib/clone-watch/vendor-gap-escalation";
import { readWeaponisedLiveness } from "@/lib/clone-watch/weaponised-liveness";

/**
 * #1234 (absorbs #1148) — the TS half of the takedown-metrics fix. The SQL half
 * is takedownMetricsSql.test.ts.
 *
 * GO-RED (each verified by reverting the named fix, running this file, seeing
 * the named test fail, and restoring):
 *   - parseTakedownStats reading a missing timed_n as n = takedowns_total (the
 *     v145 meaning) → "withholds the v145 median" fails (its mixed-clock 0
 *     would render as "0 min").
 *   - formatDurationMinutes without the `< 0` guard → "never renders a
 *     negative" fails (it printed "-2 min").
 *   - the #1148 processing check moved BELOW the no-escalatable drain in
 *     clone-watch-netcraft-issue.ts → "defers a still-processing submission
 *     before the drain can stamp it" fails.
 *   - the reconcile quiet path returning without observeWeaponisedOutcomes()
 *     → "observes weaponised outcomes on the quiet path too" fails.
 *   - readWeaponisedLiveness mapping a probe throw to `true` → "a probe that
 *     throws is inconclusive" fails.
 */

describe("parseTakedownStats — one reader, null is 'not measured'", () => {
  const v329 = {
    window_days: 30,
    takedowns_total: 8,
    median_minutes: null,
    p90_minutes: null,
    fastest_minutes: null,
    slowest_minutes: null,
    timed_n: 0,
    detect_to_block_n: 7,
    detect_to_block_median_minutes: 231,
    detect_to_block_p90_minutes: 952,
    blocked_before_detection: 0,
    already_blocklisted_at_submit: 0,
    weaponised_n: 41,
    weaponised_blocklisted: 8,
    weaponised_offline: 0,
    weaponised_open: 33,
    weaponised_vendor_gap: 20,
    weaponised_escalated: 0,
    detect_to_offline_median_minutes: null,
  };

  it("reads the v329 row, keeping an empty triage sample null", () => {
    // The prod numbers of 2026-09-26 (30-day window).
    const s = parseTakedownStats([v329])!;
    expect(s.blocklisted).toBe(8);
    expect(s.triageMinutes).toEqual({ n: 0, median: null, p90: null });
    expect(s.detectToBlock).toEqual({ n: 7, median: 231, p90: 952 });
    expect(s.cohort).toMatchObject({ weaponised: 41, blocklisted: 8, open: 33 });
  });

  it("withholds the v145 median — it subtracted two different clocks", () => {
    // What prod returned before v329: median 0, fastest −2 (alert 4327).
    const v145 = {
      window_days: 30,
      takedowns_total: 8,
      median_minutes: 0,
      p90_minutes: 162,
      fastest_minutes: -2,
      slowest_minutes: 539,
    };
    const s = parseTakedownStats([v145])!;
    expect(s.blocklisted).toBe(8);
    expect(s.triageMinutes).toBeNull();
    expect(s.detectToBlock).toBeNull();
    expect(s.cohort).toBeNull();
  });

  it("returns null for an empty result, never a zero-filled row", () => {
    expect(parseTakedownStats([])).toBeNull();
    expect(parseTakedownStats(null)).toBeNull();
  });

  it("publishes a median only at n >= floor and only when measured", () => {
    expect(publishableMedian({ n: 7, median: 231 }, 5)).toBe(231);
    expect(publishableMedian({ n: 4, median: 231 }, 5)).toBeNull();
    expect(publishableMedian({ n: 9, median: null }, 5)).toBeNull();
    expect(publishableMedian(null, 5)).toBeNull();
  });

  it("never renders a negative or an unmeasured duration", () => {
    expect(formatDurationMinutes(-2)).toBe("—");
    expect(formatDurationMinutes(null)).toBe("—");
    expect(formatDurationMinutes(0)).toBe("0 min");
    expect(formatDurationMinutes(231)).toBe("3.9h");
    expect(formatDurationMinutes(4000)).toBe("2.8d");
  });
});

describe("#1148 — a still-processing Netcraft submission", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recognises Netcraft's processing state (normalised)", () => {
    expect(isSubmissionProcessing("processing")).toBe(true);
    expect(isSubmissionProcessing(" Processing ")).toBe(true);
    expect(isSubmissionProcessing("no threats")).toBe(false);
    expect(isSubmissionProcessing(null)).toBe(false);
  });

  it("surfaces the submission state even when the pre-filter skips /urls", async () => {
    // A batch Netcraft is still working on: every URL counts as processing,
    // so the escalatable pre-filter reads it as "nothing escalatable".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            state: "processing",
            date: 1790342333,
            state_counts: { urls: { processing: 3 } },
            classification_log: [],
          }),
          { status: 200 },
        ),
      ),
    );
    const r = await fetchNetcraftSubmissionUrls("u1", {
      escalatableStates: ["no threats", "unavailable"],
    });
    expect(r.noEscalatable).toBe(true);
    expect(r.submissionState).toBe("processing");
  });

  it("defers a still-processing submission before the drain can stamp it", () => {
    // Structural: the drain that stamps `no_escalatable_state` is TERMINAL for
    // the uuid, so the processing check must come first in the loop.
    const src = readFileSync(
      new URL("../app/api/inngest/functions/clone-watch-netcraft-issue.ts", import.meta.url),
      "utf8",
    );
    const gate = src.indexOf("if (isSubmissionProcessing(fetched.submissionState))");
    const drain = src.indexOf("if (fetched.noEscalatable)");
    expect(gate).toBeGreaterThan(-1);
    expect(drain).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(drain);
  });
});

describe("reconcile observes weaponised outcomes on every run", () => {
  const src = readFileSync(
    new URL("../app/api/inngest/functions/clone-watch-netcraft-reconcile.ts", import.meta.url),
    "utf8",
  );

  it("observes weaponised outcomes on the quiet path too", () => {
    // The lane returns early when no Netcraft uuid is due — the normal state
    // since v316's backoff. The weaponised sweep must not ride on that.
    const quiet = src.slice(
      src.indexOf("if (groups.length === 0) {"),
      src.indexOf('step.run("log-cost-quiet"'),
    );
    expect(quiet).toContain("await observeWeaponisedOutcomes()");
    const full = src.slice(src.indexOf("const counts = {"), src.indexOf('step.run("log-cost",'));
    expect(full).toContain("await observeWeaponisedOutcomes()");
  });
});

describe("vendor-gap operator page", () => {
  const row = (id: number, basis = "rejected") => ({
    id,
    candidate_domain: `anz-login${id}.com`,
    brand: "ANZ",
    url_state: "no threats",
    basis,
  });

  it("sends nothing when there is nothing to escalate", () => {
    expect(buildVendorGapPage([])).toBeNull();
  });

  it("defangs every domain so Telegram cannot link the phishing site", () => {
    const page = buildVendorGapPage([row(1)])!.value;
    expect(page).toContain("anz-login1[.]com");
    expect(page).not.toContain("anz-login1.com");
    expect(defang("a.b.c")).toBe("a[.]b[.]c");
  });

  it("lists at most maxListed and counts the rest", () => {
    const rows = Array.from({ length: 13 }, (_, i) => row(i + 1, i < 9 ? "rejected" : "issue_unanswered"));
    const page = buildVendorGapPage(rows, 10)!.value;
    expect(page.match(/•/g)).toHaveLength(10);
    expect(page).toContain("…and 3 more.");
    expect(page).toContain('9 "Already reported and rejected.", 4 with our issue unanswered');
    expect(page.split("\n")).toHaveLength(2 + 10 + 1 + 1); // one line per item, never reflowed
  });
});

describe("readWeaponisedLiveness", () => {
  const targets = [
    { id: 1, candidate_domain: "gone.example" },
    { id: 2, candidate_domain: "up.example" },
    { id: 3, candidate_domain: "boom.example" },
  ];
  const probe = async (h: string) => {
    if (h === "boom.example") throw new Error("resolver exploded");
    return h === "gone.example";
  };

  it("a probe that throws is inconclusive, never gone", async () => {
    const r = await readWeaponisedLiveness(targets, { expired: () => false }, probe);
    const byId = Object.fromEntries(r.reads.map((x) => [x.id, x.gone]));
    expect(byId).toEqual({ 1: true, 2: false, 3: null });
    expect(r.unreached).toBe(0);
  });

  it("stops at the budget and counts what it left", async () => {
    const r = await readWeaponisedLiveness(targets, { expired: () => true }, probe);
    expect(r.reads).toEqual([]);
    expect(r.unreached).toBe(3);
  });
});
