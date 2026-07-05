import { describe, it, expect } from "vitest";
import type { CloneWatchReportCard } from "@/lib/clone-watch/report-card-data";
import { generateCloneWatchCaption } from "@/lib/clone-watch/clone-watch-caption";

/** June 2026 shape: HESTA super fund, globals present, baseline (no MoM). */
const JUNE: CloneWatchReportCard = {
  periodMonth: "2026-06-01",
  periodLabel: "June 2026",
  total: 804,
  brands: 129,
  kpis: { reportedToNetcraft: 628, likelyPhishing: 25, parkedForSale: 51 },
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
  superFund: { brand: "hesta.com.au", clones: 35, auRank: 2 },
};

/** July-style shape: no super fund, MoM available. */
const JULY: CloneWatchReportCard = {
  ...JUNE,
  periodMonth: "2026-07-01",
  periodLabel: "July 2026",
  total: 900,
  superFund: null,
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
      globalBrands: [],
      topRegistrars: [],
    };
    const c = generateCloneWatchCaption(only1);
    expect(c.body).toContain("One thing stood out this month:");
    expect(c.body).not.toContain("things stood out");
    expect(c.body).not.toContain("2. ");
  });

  it("MoM that rounds to 0%: 'essentially flat', never 'up 0%'", () => {
    const barelyUp: CloneWatchReportCard = {
      ...JULY,
      total: 1001,
      mom: { available: true, priorLabel: "June 2026", priorTotal: 1000, priorBrands: 129, totalDelta: 1, totalPct: 0, brandsDelta: 0 },
    };
    const c = generateCloneWatchCaption(barelyUp);
    expect(c.body).toContain("That's essentially flat on June 2026 (1000 → 1001)");
    expect(c.body).not.toMatch(/up 0%|down 0%/);
  });
});
