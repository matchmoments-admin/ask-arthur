import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchNetcraftSubmissionUrls,
  isSubmissionProcessing,
} from "@/lib/clone-watch/netcraft-urls";
import {
  formatDurationMinutes,
  parseTakedownStats,
  blocklistTile,
  NETCRAFT_SUBMIT_CADENCE,
  publishableMedian,
} from "@/lib/clone-watch/takedown-stats";
import {
  buildVendorGapPage,
  defang,
  dnsLastLabel,
  escalateVendorGap,
} from "@/lib/clone-watch/vendor-gap-escalation";
import { NETCRAFT_DEFERRAL } from "@/lib/clone-watch/netcraft-deferral";
import {
  aggregateClonesByDomain,
  weaponisedAfterDecline,
} from "@/lib/clone-watch/clone-metrics";
import {
  buildOutcomesBlock,
  weaponisedStateCaveat,
} from "@/lib/clone-watch/outcome-copy";
import { readWeaponisedLiveness } from "@/lib/clone-watch/weaponised-liveness";
import { LANE_SHAPES } from "@/lib/laneHealth";

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
 *
 * Review round (#1254), each also verified red then restored:
 *   - escalateVendorGap calling mark() after a failed send → "a failed send
 *     … stamps NOTHING" fails.
 *   - the #1148 gate deferring with `transient_state` again → "defers with
 *     `processing`" fails.
 *   - aggregateClonesByDomain counting weaponisedAfterDecline only while
 *     lifecycle_state is weaponised → "keeps a flipped clone that went
 *     dormant or was taken down" fails.
 *   - the September caveat dropped from buildOutcomesBlock → "captions the
 *     transition month, and only it" fails.
 *   - blocklistTile's sub back to "(n=7)" → "labels the sample against the
 *     weaponised cohort" fails.
 *   (laneHealth, weekly-digest and lifecycle go-reds are recorded beside
 *   their tests in laneHealth.test.ts, cloneWatchOutreach.test.ts and
 *   cloneWatchLifecycle.test.ts.)
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
    expect(page).toContain("…and 3 more — all listed on /admin/clone-watch.");
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

// ── Review fixes (#1254) ────────────────────────────────────────────────────

describe("escalateVendorGap — list → page → mark, never throws", () => {
  const rows = [
    { id: 1, candidate_domain: "a.example", brand: "ANZ", url_state: "no threats", basis: "rejected", dns_last: "present" },
    { id: 2, candidate_domain: "b.example", brand: "NAB", url_state: "unavailable", basis: "issue_unanswered", dns_last: null },
  ];
  const harness = (send: { ok: boolean; reason?: string; error?: string }) => {
    const calls: string[] = [];
    const audited: number[] = [];
    const deps = {
      list: async () => {
        calls.push("list");
        return { rows };
      },
      send: async () => {
        calls.push("send");
        return send;
      },
      mark: async (ids: number[]) => {
        calls.push(`mark:${ids.join(",")}`);
        return { marked: ids.length };
      },
      audit: (r: { id: number }) => {
        audited.push(r.id);
      },
    };
    return { deps, calls, audited };
  };

  it("pages BEFORE it stamps, and audits one event per alert", async () => {
    const h = harness({ ok: true });
    const out = await escalateVendorGap(h.deps);
    expect(h.calls).toEqual(["list", "send", "mark:1,2"]);
    expect(out).toEqual({ escalated: 2, paged: true });
    expect(h.audited).toEqual([1, 2]);
  });

  it("a failed send (Telegram 5xx/429) returns an error and stamps NOTHING", async () => {
    const h = harness({ ok: false, reason: "send_failed", error: "HTTP 502" });
    const out = await escalateVendorGap(h.deps);
    expect(h.calls).toEqual(["list", "send"]); // no mark → rows re-list next run
    expect(out).toEqual({ escalated: 0, paged: false, unpaged: 2, error: "page: HTTP 502" });
    expect(h.audited).toEqual([]);
  });

  it("a failed list or mark reads null, never a clean zero", async () => {
    const listFail = await escalateVendorGap({
      ...harness({ ok: true }).deps,
      list: async () => ({ error: "function not found" }),
    });
    expect(listFail).toMatchObject({ escalated: null, error: "list: function not found" });
    const markFail = await escalateVendorGap({
      ...harness({ ok: true }).deps,
      mark: async () => ({ error: "timeout" }),
    });
    expect(markFail).toMatchObject({ escalated: null, paged: true, error: "mark: timeout" });
  });

  it("the page says what our DNS saw, per row — never 'still up' for an unread one", () => {
    const page = buildVendorGapPage(rows)!.value;
    expect(page).toContain("a[.]example</code> — ANZ · Netcraft: no threats · DNS: resolves");
    expect(page).toContain("b[.]example</code> — NAB · Netcraft: unavailable · DNS: not yet read");
    expect(page).toContain("Our last DNS read: 1 resolve, 1 inconclusive or not yet read.");
    expect(page).not.toContain("did not find it gone");
    expect(dnsLastLabel("inconclusive")).toBe("DNS: inconclusive");
  });
});

describe("#1148 — processing has its own deferral reason", () => {
  it("defers with `processing`, not the shared `transient_state` rounds", () => {
    const src = readFileSync(
      new URL("../app/api/inngest/functions/clone-watch-netcraft-issue.ts", import.meta.url),
      "utf8",
    );
    const gate = src.slice(
      src.indexOf("if (isSubmissionProcessing(fetched.submissionState))"),
      src.indexOf("if (fetched.noEscalatable)"),
    );
    expect(gate).toContain('bulkDefer(allIds, "processing", PROCESSING_RECHECK_MS)');
    expect(gate).not.toContain("transient_state");
    expect(NETCRAFT_DEFERRAL.issue.processingRecheckMs).toBe(24 * 3600 * 1000);
  });
});

describe("weaponisedAfterDecline — from timestamps, so it does not erode", () => {
  const declined = "2026-08-01T00:00:00Z";
  const after = "2026-08-05T00:00:00Z";
  it("counts a flipped clone whatever its state is now", () => {
    // The liveness sweep moves ~63 weaponised to dormant; a Netcraft takedown
    // moves others to taken_down. Neither un-happens the flip.
    expect(weaponisedAfterDecline({ weaponised_at: after, netcraft_declined_at: declined })).toBe(true);
  });
  it("needs both timestamps, in that order", () => {
    expect(weaponisedAfterDecline({ weaponised_at: declined, netcraft_declined_at: after })).toBe(false);
    expect(weaponisedAfterDecline({ weaponised_at: after, netcraft_declined_at: null })).toBe(false);
    expect(weaponisedAfterDecline({ weaponised_at: null, netcraft_declined_at: declined })).toBe(false);
  });
  it("aggregateClonesByDomain keeps a flipped clone that went dormant or was taken down", () => {
    const base = {
      inferred_target_domain: "anz.com.au",
      urlscan_classification: "likely_phishing",
      urlscan_evidence: null,
      attribution: null,
      submitted_to: null,
      weaponised_at: after,
      netcraft_declined_at: declined,
    };
    const m = aggregateClonesByDomain([
      { ...base, id: 1, candidate_domain: "a.example", lifecycle_state: "dormant" },
      { ...base, id: 2, candidate_domain: "b.example", lifecycle_state: "taken_down" },
      { ...base, id: 3, candidate_domain: "c.example", lifecycle_state: "weaponised" },
    ]).get("anz.com.au")!;
    expect(m.weaponised).toBe(1); // current state, labelled so
    expect(m.weaponisedAfterDecline).toBe(3);
  });
});

describe("September confounder for the current-state weaponised count", () => {
  it("captions the transition month, and only it", () => {
    const kpis = { reportedToNetcraft: 10, takenDown: 0, declined: 0, escalated: 0, weaponised: 4, weaponisedAfterDecline: 0, reTakenDown: 0 };
    expect(buildOutcomesBlock(kpis, { periodMonth: "2026-09-01" })).toContain(
      "a lower figure than last month reflects that check, not fewer attacks",
    );
    expect(buildOutcomesBlock(kpis, { periodMonth: "2026-10-01" })).not.toContain("that check");
    expect(buildOutcomesBlock(kpis)).not.toContain("that check");
    expect(weaponisedStateCaveat("2026-09")).not.toBe("");
  });
});

describe("public blocklist metric wording lives in the metric module", () => {
  it("labels the sample against the weaponised cohort and names our submit cadence", () => {
    const s = parseTakedownStats([
      { window_days: 30, takedowns_total: 8, timed_n: 0, detect_to_block_n: 7, detect_to_block_median_minutes: 231, weaponised_n: 41 },
    ])!;
    const tile = blocklistTile(s, 5)!;
    expect(tile.value).toBe("3.9h");
    expect(tile.sub).toBe("phishing detected → Netcraft blocklist · n=7 of 41 weaponised in window");
    expect(tile.note).toContain("13:00 UTC");
    // The cadence the note names is the auto lane's real cron, not a copy that can drift.
    expect(LANE_SHAPES["shopfront-clone-netcraft-auto/auto"].crons).toContain(
      `0 ${NETCRAFT_SUBMIT_CADENCE.slice(0, 2)} * * *`,
    );
    expect(tile.note).toContain("not Netcraft");
    expect(blocklistTile({ ...s, detectToBlock: { n: 4, median: 231, p90: null } }, 5)).toBeNull();
  });
});
