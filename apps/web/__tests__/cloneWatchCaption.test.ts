import { describe, it, expect } from "vitest";
import type { CloneWatchReportCard } from "@/lib/clone-watch/report-card-data";
import {
  buildOutcomesBlock,
  buildOutcomesLine,
  hasOutcomes,
  lifecycleBadge,
  publicListBadge,
  stewardshipOutcomeLines,
} from "@/lib/clone-watch/outcome-copy";
import { generateCloneWatchCaption } from "@/lib/clone-watch/clone-watch-caption";

/** June 2026 shape: HESTA super fund, globals present, baseline (no MoM). */
const JUNE: CloneWatchReportCard = {
  periodMonth: "2026-06-01",
  periodLabel: "June 2026",
  total: 804,
  brands: 129,
  watchlistSize: 293,
  kpis: {
    reportedToNetcraft: 628,
    likelyPhishing: 25,
    parkedForSale: 51,
    neutral: 0,
    unresolved: 0,
    unclassified: 0,
    takenDown: 0,
    declined: 0,
    escalated: 0,
    weaponised: 0,
    weaponisedAfterDecline: 0,
    reTakenDown: 0,
  },
  topAuBrands: [
    { brand: "target.com.au", clones: 43 },
    { brand: "hesta.com.au", clones: 35 },
    { brand: "kmart.com.au", clones: 28 },
    { brand: "bonds.com.au", clones: 25 },
    { brand: "qantas.com.au", clones: 23 },
  ],
  globalBrands: [
    { brand: "hellostake.com", clones: 53 },
    { brand: "apple.com", clones: 42 },
    { brand: "google.com", clones: 21 },
  ],
  topRegistrars: [
    { registrar: "Dynadot", clones: 60 },
    { registrar: "GMO Internet (Onamae)", clones: 55 },
    { registrar: "GoDaddy", clones: 39 },
  ],
  unknownRegistrarCount: 378,
  mom: {
    available: false,
    priorLabel: "May 2026",
    priorTotal: 0,
    priorBrands: 0,
    totalDelta: 804,
    totalPct: null,
    brandsDelta: 129,
  },
  targeting: {
    tactics: { top: [], other: 0, unknown: 0, total: 0 },
    intents: { top: [], other: 0, unknown: 0, total: 0 },
    tlds: { top: [], other: 0, unknown: 0, total: 0 },
    hosting: {
      asns: { top: [], other: 0, unknown: 0, total: 0 },
      countries: { top: [], other: 0, unknown: 0, total: 0 },
      frontedN: 0,
      unattributedN: 0,
      originVisibleN: 0,
      total: 0,
    },
    clusters: { clusters: [], fingerprintedN: 0, unfingerprintedN: 0, largestClusterN: 0, total: 0 },
    rejectedN: 0,
  },
  brandTrends: {
    claimable: [],
    excluded: { claimable: 0, unchanged: 0, coverageStarted: 0, coverageEnded: 0, belowFloor: 0, unknown: 0, methodChanged: 0 },
    publishable: true,
  },
  superFund: { brand: "hesta.com.au", clones: 35, auRank: 2 },
  // June 2026 genuinely led with the fund — the ladder only blocks a REPEAT.
  spotlight: { kind: "super_fund" as const, brand: "hesta.com.au", clones: 35, auRank: 2 },
  durations: {
    declineToWeaponise: { n: 0, medianHours: null },
    weaponiseToRefile: { n: 0, medianHours: null },
    refileToTakedown: { n: 0, medianHours: null },
    fullLoop: { n: 0, medianHours: null },
    excludedNegativeN: 0,
    anomalousInversionsN: 0,
    asOf: "2026-07-01T00:00:00.000Z",
  },
  registrarWeaponisation: [],
  tldWeaponisation: [],
  campaigns: { campaignCount: 0, clusteredDomains: 0, largestCampaign: 0, top: [] },
};

/** July-style shape: no super fund, MoM available. */
const JULY: CloneWatchReportCard = {
  ...JUNE,
  periodMonth: "2026-07-01",
  periodLabel: "July 2026",
  total: 900,
  superFund: null,
  spotlight: { kind: "globals" as const, brand: "", clones: 0, auRank: 0 },
  mom: {
    available: true,
    priorLabel: "June 2026",
    priorTotal: 804,
    priorBrands: 129,
    totalDelta: 96,
    totalPct: 12,
    brandsDelta: 5,
  },
};

describe("generateCloneWatchCaption", () => {
  it("June: super-fund angle, exact numbers, month-one framing, #Superannuation", () => {
    const c = generateCloneWatchCaption(JUNE);
    expect(c.documentTitle).toBe("Australian Clone Watch — June 2026");
    // numbers come only from the data
    expect(c.body).toContain("we detected 804 newly-registered copycat domains");
    expect(c.body).toContain("Target was the most-copied Australian brand (43 lookalike domains)");
    expect(c.body).toContain("Kmart (28)");
    // super-fund finding, casing + spelled-out rank + exact count
    expect(c.body).toContain(
      "HESTA, an industry super fund, was the second most-targeted Australian brand (35)",
    );
    // registrar caption-friendly name (no double parens) + WHOIS caveat
    expect(c.body).toContain("Dynadot (60) and GMO Internet (55) led the registrars");
    expect(c.body).toContain("378 of the 804 sat behind WHOIS privacy");
    // globals as a standalone line (since super fund took finding 2)
    expect(c.body).toContain("Global brands were aimed at Australians too — Stake (53)");
    // month-one series hook + Scamwatch CTA
    expect(c.body).toContain("This is month one. Next month you'll see whether 804");
    expect(c.body).toContain("Report it — to us and to Scamwatch");
    // guardrails: no "confirmed clones", link not in body
    expect(c.body).not.toMatch(/confirmed clone/i);
    expect(c.body).not.toContain("askarthur.au");
    // hashtags
    expect(c.hashtags).toContain("#Superannuation");
    expect(c.hashtags).toHaveLength(4);
    expect(c.bodyWithHashtags).toContain("#ScamAwareness #CyberSecurity #Australia #Superannuation");
    // first comment carries the link
    expect(c.firstComment).toContain("https://askarthur.au");
    expect(c.firstComment).not.toContain("How we count these");
  });

  it("July: no super fund → globals become finding 2, MoM delta line, #FraudPrevention", () => {
    const c = generateCloneWatchCaption(JULY);
    expect(c.body).not.toMatch(/super fund/i);
    expect(c.body).toContain("It's not just local brands. Global names were aimed at Australians too");
    expect(c.body).toContain("That's up 12% on June 2026 (804 → 900)");
    expect(c.body).not.toContain("This is month one");
    expect(c.hashtags).toContain("#FraudPrevention");
    expect(c.hashtags).not.toContain("#Superannuation");
  });

  it("method-url adds the citation line to the first comment", () => {
    const c = generateCloneWatchCaption(JUNE, "https://askarthur.au/clone-watch/method");
    expect(c.firstComment).toContain("How we count these → https://askarthur.au/clone-watch/method");
  });

  it("super fund as the #1 AU brand: folded into finding 1, not named/crowned twice", () => {
    const fundLeads: CloneWatchReportCard = {
      ...JUNE,
      topAuBrands: [
        { brand: "hesta.com.au", clones: 50 },
        { brand: "target.com.au", clones: 43 },
        { brand: "kmart.com.au", clones: 28 },
      ],
      superFund: { brand: "hesta.com.au", clones: 50, auRank: 1 },
      spotlight: { kind: "globals" as const, brand: "", clones: 0, auRank: 0 },
    };
    const c = generateCloneWatchCaption(fundLeads);
    expect(c.body).toContain(
      "A super fund led the month: HESTA was the most-copied Australian brand (50 lookalike domains)",
    );
    // no separate spotlight finding, and not two contradictory "#1" claims
    expect(c.body).not.toContain("It's not just shopping — or banking. HESTA");
    expect(c.body).not.toContain("the most-targeted Australian brand (50)");
    // Target/Kmart still listed as close behind (HESTA excluded from that list)
    expect(c.body).toContain("with Target (43) and Kmart (28) close behind");
  });

  it("single finding: 'One thing stood out' (singular), no orphan numbering", () => {
    const only1: CloneWatchReportCard = {
      ...JUNE,
      superFund: null,
      spotlight: { kind: "globals" as const, brand: "", clones: 0, auRank: 0 },
      globalBrands: [],
      topRegistrars: [],
    };
    const c = generateCloneWatchCaption(only1);
    expect(c.body).toContain("One thing stood out this month:");
    expect(c.body).not.toContain("things stood out");
    expect(c.body).not.toContain("2. ");
  });

  it("MoM within counting noise: 'about the same', never 'up 0%' (#1226)", () => {
    const barelyUp: CloneWatchReportCard = {
      ...JULY,
      total: 1001,
      mom: { available: true, priorLabel: "June 2026", priorTotal: 1000, priorBrands: 129, totalDelta: 1, totalPct: 0, brandsDelta: 0 },
    };
    const c = generateCloneWatchCaption(barelyUp);
    expect(c.body).toContain("That's about the same as June 2026 (1000 → 1001)");
    expect(c.body).not.toMatch(/up 0%|down 0%/);
  });

  it("all-zero lifecycle KPIs (June's real state): NO outcomes block, caption unchanged", () => {
    const c = generateCloneWatchCaption(JUNE);
    expect(c.body).not.toContain("takedown vendor");
    expect(c.body).not.toContain("actioned");
    expect(c.body).not.toContain("no threat");
  });

  it("lifecycle outcomes render the vendor-gap story with honest, composable arithmetic", () => {
    const withOutcomes: CloneWatchReportCard = {
      ...JULY,
      kpis: {
        ...JULY.kpis,
        reportedToNetcraft: 120,
        takenDown: 3,
        declined: 40,
        escalated: 2,
        weaponised: 8,
        weaponisedAfterDecline: 1,
        reTakenDown: 1,
      },
    };
    const c = generateCloneWatchCaption(withOutcomes);
    // reTakenDown folds INTO the actioned figure — never additive.
    expect(c.body).toContain(
      "Of the 120 we reported to a takedown vendor: 3 have been actioned (including 1 only after we escalated) and 40 are currently graded “no threat” and left live.",
    );
    // The flip claim attaches ONLY to weaponisedAfterDecline — its own
    // sentence since v329 (from timestamps, not a subset of `weaponised`).
    expect(c.body).toContain("Our scans confirmed 8 domains now serving active phishing.");
    expect(c.body).toContain(
      "1 lookalike served phishing after the vendor had graded it “no threat” — proof that “no threat” doesn’t mean safe.",
    );
    expect(c.body).not.toContain("of them");
    // Escalation claimed only via the real count.
    expect(c.body).toContain(
      "We have escalated 2 back to the vendor with the scan evidence.",
    );
    // Honesty guardrails: their action, never ours; no confirmed-clone claims;
    // still no URL in the body; never a time-to-takedown figure.
    expect(c.body).not.toMatch(/we took down|we removed/i);
    expect(c.body).not.toMatch(/confirmed clone/i);
    expect(c.body).not.toContain("askarthur.au");
    expect(c.body).not.toMatch(/time.to.takedown|median/i);
  });
});

describe("card.note — the restatement channel", () => {
  // A restated series that does not SAY it has been restated is the problem.
  // The August 2026 edition restated June (804→664) and July (1064→915) after
  // the v4 matcher fix, while both were already published on LinkedIn with the
  // old numbers — so the caption's own "915 → 855" sentence contradicted a
  // live post with nothing to explain it.
  it("emits the note immediately after the month-on-month sentence", () => {
    const note = "July's figure is restated on a tightened method.";
    const c = generateCloneWatchCaption({ ...JULY, note });
    expect(c.body).toContain(note);
    const seriesIdx = c.body.indexOf("We publish this every month");
    const noteIdx = c.body.indexOf(note);
    expect(seriesIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(seriesIdx);
  });

  it("changes nothing when absent", () => {
    expect(generateCloneWatchCaption(JULY).body).toBe(
      generateCloneWatchCaption({ ...JULY, note: undefined }).body,
    );
  });
});

describe("buildOutcomesBlock (caption paragraph)", () => {
  const ZERO = {
    reportedToNetcraft: 100,
    takenDown: 0,
    declined: 0,
    escalated: 0,
    weaponised: 0,
    weaponisedAfterDecline: 0,
    reTakenDown: 0,
  };

  it("no false-escalation claim: weaponised>0 with escalated=0 says nothing about escalating", () => {
    const block = buildOutcomesBlock({ ...ZERO, declined: 20, weaponised: 3 });
    expect(block).toContain("3 domains now serving active phishing");
    expect(block.toLowerCase()).not.toContain("escalat");
  });

  it("no flip attribution when weaponisedAfterDecline=0 (most weaponised were phishing at first scan)", () => {
    const block = buildOutcomesBlock({ ...ZERO, weaponised: 5 });
    expect(block).toContain("Our scans confirmed 5 domains now serving active phishing.");
    expect(block).not.toContain("no threat");
    expect(block).not.toContain("flipped");
  });

  it("self-contained weaponised sentence even with no lead (declined=0, takenDown=0)", () => {
    const block = buildOutcomesBlock({ ...ZERO, weaponised: 2, weaponisedAfterDecline: 1 });
    expect(block).toBe(
      "Our scans confirmed 2 domains now serving active phishing. 1 lookalike served phishing after the vendor had graded it “no threat” — proof that “no threat” doesn’t mean safe.",
    );
    expect(block).not.toContain("of those");
  });

  it("partial zeros: no '0 have been actioned' clause; singular forms are grammatical", () => {
    const declinedOnly = buildOutcomesBlock({ ...ZERO, declined: 25 });
    expect(declinedOnly).toBe(
      "Of the 100 we reported to a takedown vendor: 25 are currently graded “no threat” and left live.",
    );
    expect(declinedOnly).not.toMatch(/\b0 (has|have|is|are)\b/);

    const singulars = buildOutcomesBlock({
      ...ZERO,
      reportedToNetcraft: 10,
      takenDown: 1,
      declined: 1,
      weaponised: 1,
    });
    expect(singulars).toContain("1 has been actioned");
    expect(singulars).toContain("1 is currently graded “no threat”");
    expect(singulars).toContain("1 domain now serving active phishing");
    expect(singulars).not.toContain("1 domains");
    expect(singulars).not.toContain("of those");
  });

  it("escalated-only month renders (hasOutcomes includes escalated); all-zero renders nothing", () => {
    const escalatedOnly = buildOutcomesBlock({ ...ZERO, escalated: 5 });
    expect(escalatedOnly).toBe(
      "We have escalated 5 back to the vendor with the scan evidence.",
    );
    expect(hasOutcomes({ ...ZERO, escalated: 5 })).toBe(true);
    expect(buildOutcomesBlock(ZERO)).toBe("");
    expect(hasOutcomes(ZERO)).toBe(false);
  });
});

describe("buildOutcomesLine (slide 06)", () => {
  const ZERO = {
    takenDown: 0,
    declined: 0,
    escalated: 0,
    weaponised: 0,
    weaponisedAfterDecline: 0,
    reTakenDown: 0,
  };

  it("joins non-zero outcomes with the ledger separator; reTakenDown folds into actioned", () => {
    const line = buildOutcomesLine({
      takenDown: 3,
      declined: 40,
      escalated: 2,
      weaponised: 8,
      weaponisedAfterDecline: 1,
      reTakenDown: 1,
    });
    expect(line).toBe(
      "3 actioned by Netcraft (incl. 1 after our escalation) · 40 currently graded “no threat” and left live · 8 confirmed serving active phishing by our scans · 1 served phishing after being graded “no threat” · 2 escalated back with scan evidence",
    );
  });

  it("omits zero parts, the escalation parenthetical, and the flip attribution when zero", () => {
    const line = buildOutcomesLine({ ...ZERO, declined: 12, weaponised: 1 });
    expect(line).toBe(
      "12 currently graded “no threat” and left live · 1 confirmed serving active phishing by our scans",
    );
    expect(line).not.toContain("escalat");
    expect(line).not.toContain("previously graded");
  });

  it("escalated-only month renders; empty on all-zero months", () => {
    expect(buildOutcomesLine({ ...ZERO, escalated: 4 })).toBe(
      "4 escalated back with scan evidence",
    );
    expect(buildOutcomesLine(ZERO)).toBe("");
  });

  it("quote style matches the caption builder (typographic “ ” in both)", () => {
    const line = buildOutcomesLine({ ...ZERO, declined: 5 });
    const block = buildOutcomesBlock({
      ...ZERO,
      reportedToNetcraft: 10,
      declined: 5,
    });
    expect(line).toContain("“no threat”");
    expect(block).toContain("“no threat”");
    expect(line).not.toContain('"no threat"');
    expect(block).not.toContain('"no threat"');
  });
});

describe("lifecycleBadge (watch-list vocabulary)", () => {
  it("labels each state with the honest verbs — never 'removed'/'we took down'/flat 'still live'", () => {
    expect(lifecycleBadge("weaponised")).toEqual({ label: "ACTIVE PHISHING", color: "#dc2626" });
    expect(lifecycleBadge("declined")!.label).toBe("GRADED NO-THREAT — UNACTIONED");
    expect(lifecycleBadge("monitoring")!.label).toBe("UNDER MONITORING");
    expect(lifecycleBadge("taken_down")!.label).toBe("ACTIONED BY NETCRAFT");
    expect(lifecycleBadge("dormant")!.label).toBe("DORMANT");
    for (const s of ["weaponised", "declined", "monitoring", "taken_down", "dormant"]) {
      const label = lifecycleBadge(s)!.label.toLowerCase();
      expect(label).not.toContain("removed");
      expect(label).not.toContain("we took");
      // lifecycle_state is not a liveness probe — no flat "still live" claims.
      expect(label).not.toContain("still live");
    }
  });

  it("returns null for detected/null/unknown (nothing honest to badge)", () => {
    expect(lifecycleBadge("detected")).toBeNull();
    expect(lifecycleBadge(null)).toBeNull();
    expect(lifecycleBadge("reported")).toBeNull();
  });
});

/**
 * The 2,900-char cap is enforced by a THROW in scripts/clone-watch-caption.ts —
 * correct (a truncated honesty caveat is worse than none), but it fires at
 * prepare time, which is AFTER the founder has reviewed the edition. This
 * builds the worst caption the generator can produce and asserts it fits, so
 * new copy is caught here instead of at publish.
 */
describe("caption stays under the LinkedIn cap in the worst case", () => {
  const CAPTION_MAX = 2_900;

  const WORST: CloneWatchReportCard = {
    ...JUNE,
    // Longest month label, a full mover story, every outcome bucket non-zero,
    // and all three targeting lines present at once.
    periodLabel: "September 2026",
    total: 1032,
    brands: 155,
    kpis: {
      ...JUNE.kpis,
      reportedToNetcraft: 888,
      likelyPhishing: 52,
      parkedForSale: 1,
      takenDown: 15,
      declined: 543,
      escalated: 12,
      weaponised: 45,
      weaponisedAfterDecline: 9,
      reTakenDown: 3,
    },
    mom: {
      available: true,
      priorLabel: "August 2026",
      priorTotal: 804,
      priorBrands: 129,
      totalDelta: 228,
      totalPct: 28,
      brandsDelta: 26,
      // #1226: every new sentence at its longest — feed-shift caveat and a
      // three-month line with long labels, plus the "about the same" count.
      noise: false,
      feedShift: { priorSwept: 2_100_000, currentSwept: 1_400_000, pct: -33 },
      series: [
        { label: "September 2026", total: 1032 },
        { label: "September 2026", total: 1032 },
        { label: "September 2026", total: 1032 },
      ],
    },
    brandTrends: {
      claimable: [],
      excluded: {
        claimable: 38,
        unchanged: 25,
        coverageStarted: 7,
        coverageEnded: 2,
        belowFloor: 108,
        unknown: 3, methodChanged: 0,
      },
      publishable: true,
    },
    targeting: {
      ...JUNE.targeting,
      tactics: { top: [], other: 0, unknown: 0, total: 887 },
      // The count the classifier actually rejected — NOT 1032 - 887, which
      // would also sweep in every row it never judged.
      rejectedN: 145,
      tlds: {
        top: [
          { key: "online", n: 132 },
          { key: "com", n: 129 },
          { key: "shop", n: 111 },
        ],
        other: 660,
        unknown: 0,
        total: 1032,
      },
    },
  };

  it("sheds the three-month line, never the disclosure, when a heavy month overruns (#1226)", () => {
    const c = generateCloneWatchCaption(WORST, "https://askarthur.au/method");
    expect(c.body).not.toContain("Three months:");
    expect(c.body).toContain("33% smaller"); // the feed caveat stays
    const light = generateCloneWatchCaption(
      { ...WORST, brandTrends: { ...WORST.brandTrends, excluded: { ...WORST.brandTrends.excluded, unchanged: 0 } }, mom: { ...WORST.mom, feedShift: null } },
      "https://askarthur.au/method",
    );
    expect(light.body).toContain("Three months:"); // kept when it fits
  });

  it("fits, with the disclosure intact", () => {
    const c = generateCloneWatchCaption(WORST, "https://askarthur.au/method");
    expect(c.bodyWithHashtags.length).toBeLessThanOrEqual(CAPTION_MAX);
    // The disclosure is the line that must never be the one that gets cut.
    expect(c.body).toContain("38 brands");
    expect(c.body).toContain("a count, not a trend");
  });

  it("carries the TLD finding and the classifier caveat", () => {
    const c = generateCloneWatchCaption(WORST, "https://askarthur.au/method");
    expect(c.body).toContain(".online");
    expect(c.body).toContain("judged coincidental");
  });

  it("still forbids time-to-takedown, as outcome-copy requires", () => {
    const c = generateCloneWatchCaption(WORST, "https://askarthur.au/method");
    expect(c.body).not.toMatch(/time.to.takedown|median/i);
  });
});

/**
 * PR-D (map #1224) — one wording home per published fact, pinned on the
 * caption. GO-RED record:
 *   - the old claimable=0 matcher sentence restored in buildTrendDisclosure →
 *     "states a matcher change exactly once" fails (2 occurrences);
 *   - the caption's own mover template restored (">= priorClones * 2" +
 *     ", more than double") → "words the mover through moverCopy" fails;
 *   - the "290+" literal arithmetic replaced by a fixed "~50" →
 *     "quotes the monitored-brand count in the shared wording" fails.
 */
describe("caption — one wording per fact (PR-D)", () => {
  it("states a matcher change exactly once", () => {
    const card: CloneWatchReportCard = {
      ...JULY,
      mom: { ...JULY.mom, available: false, methodChanged: true },
      brandTrends: {
        ...JULY.brandTrends,
        excluded: { ...JULY.brandTrends.excluded, belowFloor: 60, methodChanged: 40 },
      },
    };
    const body = generateCloneWatchCaption(card).body;
    expect(body.match(/changed how lookalikes are matched/g)?.length).toBe(1);
  });

  it("words the mover through moverCopy (exactly double is 'doubled')", () => {
    const card: CloneWatchReportCard = {
      ...JULY,
      spotlight: { kind: "mover", brand: "kmart.com.au", clones: 56, auRank: 3, priorClones: 28, delta: 28 },
    };
    const body = generateCloneWatchCaption(card).body;
    expect(body).toContain("its lookalike domains doubled, from 28 last month to 56");
    expect(body).not.toMatch(/more than double/);
  });

  it("quotes the monitored-brand count in the shared wording", () => {
    expect(generateCloneWatchCaption(JUNE).body).toContain("against 290+ major Australian brands");
  });
});

describe("stewardshipOutcomeLines (Brand Stewardship email)", () => {
  const zero = {
    takenDown: 0,
    declined: 0,
    escalated: 0,
    weaponised: 0,
    weaponisedAfterDecline: 0,
    reTakenDown: 0,
  };

  // GO-RED: re-nesting the flip line under `weaponised > 0` fails this; so
  // does dropping weaponisedAfterDecline from hasOutcomes (the block hides).
  it("shows the flip even when nothing is weaponised now (it went offline)", () => {
    const k = { ...zero, weaponisedAfterDecline: 2 };
    expect(hasOutcomes(k)).toBe(true);
    const lines = stewardshipOutcomeLines(k, "ANZ");
    expect(lines.map((l) => l.kind)).toEqual(["weaponised_after_decline"]);
    expect(lines[0]!.text).toContain("after Netcraft had graded them “no threat”");
  });

  // GO-RED: restoring "of those we escalated" fails this.
  it("escalated is its own line, never 'of those' (it is not a subset of declined)", () => {
    const lines = stewardshipOutcomeLines({ ...zero, declined: 1, escalated: 3 }, "ANZ");
    const text = lines.map((l) => l.text).join(" ");
    expect(text).not.toMatch(/of those|of them/i);
    expect(lines.find((l) => l.kind === "escalated")!.n).toBe(3);
  });

  it("keeps the verb discipline", () => {
    const lines = stewardshipOutcomeLines(
      { takenDown: 2, declined: 1, escalated: 1, weaponised: 1, weaponisedAfterDecline: 1, reTakenDown: 1 },
      "ANZ",
    );
    const text = lines.map((l) => l.text).join(" ");
    expect(text).toContain("actioned by Netcraft");
    expect(text).toContain("including 1 only after we escalated");
    expect(text).not.toMatch(/we took down|we removed|removed by/i);
    expect(lines.every((l) => l.n > 0)).toBe(true);
  });
});

describe("publicListBadge (/clone-watch list rows)", () => {
  it("names what happened after we reported it — and nothing it cannot prove", () => {
    expect(publicListBadge("taken_down", null)!.label).toBe("Actioned by Netcraft");
    expect(publicListBadge("taken_down", null)!.title).toMatch(/may still be online/);
    expect(publicListBadge("dormant", "2026-09-26T10:01:47Z")!.label).toBe("Offline");
    // v285's never-scanned dormant: no evidence either way → no badge.
    expect(publicListBadge("dormant", null)).toBeNull();
    expect(publicListBadge("weaponised", null)).toBeNull();
    expect(publicListBadge(null, null)).toBeNull();
  });
});
