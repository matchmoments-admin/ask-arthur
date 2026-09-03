import { describe, expect, it } from "vitest";
import {
  buildClassifierCaveat,
  buildTldLine,
  buildTrendDisclosure,
  tacticLabel,
} from "@/lib/clone-watch/targeting-copy";

/**
 * These pin the honesty rules in targeting-copy.ts's header. They exist because
 * every one of them corresponds to a wrong claim that was live, drafted, or
 * nearly published during this work.
 */

const ALL_COPY = (): string[] => [
  buildTrendDisclosure({
    claimable: 38,
    coverageStarted: 7,
    coverageEnded: 1,
    belowFloor: 108,
    unknown: 0,
  }),
  buildClassifierCaveat(1032, 887),
  buildTldLine(
    [
      { key: "online", n: 132 },
      { key: "com", n: 129 },
      { key: "shop", n: 111 },
    ],
    1032,
  ),
  ...Object.keys({
    typosquat: 1,
    compound_word: 1,
    brandjack: 1,
    lookalike_tld: 1,
    homograph: 1,
    subdomain_abuse: 1,
    parked: 1,
    unrelated: 1,
    other: 1,
  }).map(tacticLabel),
];

describe("forbidden claims (the rules that were actually broken)", () => {
  it("never says campaign, coordinated, or actor", () => {
    // campaign_key hashes registrar + nameservers + ASN + cert issuer — nothing
    // actor-specific. The outreach email was shipping "a coordinated campaign"
    // to the impersonated brand until this work; that wording must not come
    // back through the report.
    for (const line of ALL_COPY()) {
      expect(line).not.toMatch(/campaign|coordinated|one actor|threat actor/i);
    }
  });

  it("never describes what a site DOES from a tactic label", () => {
    // The classifier only ever sees {brand, candidate_domain, candidate_url}.
    // Tactic describes the NAME; anything about pages, forms, logins or
    // payments would be a claim about content nobody loaded.
    for (const line of ALL_COPY()) {
      expect(line).not.toMatch(
        /phishing page|login form|payment form|steals|harvests|urgency/i,
      );
    }
  });

  it("never states a bare percentage without its denominator", () => {
    for (const line of ALL_COPY()) {
      if (/%/.test(line)) {
        expect(line).toMatch(/\bof\b|\bout of\b/);
      }
    }
  });
});

describe("buildTrendDisclosure", () => {
  it("names every exclusion reason and totals them", () => {
    const s = buildTrendDisclosure({
      claimable: 38,
      coverageStarted: 7,
      coverageEnded: 1,
      belowFloor: 108,
      unknown: 0,
    });
    expect(s).toContain("38 brands");
    expect(s).toContain("116 are excluded"); // 7 + 1 + 108
    expect(s).toContain("7 we only started monitoring part-way through");
    expect(s).toContain("1 we stopped monitoring part-way through");
    expect(s).toContain("108 had too few lookalikes");
    expect(s).toContain("a count, not a trend");
  });

  it("distinguishes started from stopped", () => {
    // Saying "we started watching these" about brands we stopped watching is
    // the opposite of what happened — the whole reason coverage_ended exists.
    const started = buildTrendDisclosure({
      claimable: 5, coverageStarted: 3, coverageEnded: 0, belowFloor: 0, unknown: 0,
    });
    const ended = buildTrendDisclosure({
      claimable: 5, coverageStarted: 0, coverageEnded: 3, belowFloor: 0, unknown: 0,
    });
    expect(started).toContain("only started monitoring");
    expect(started).not.toContain("stopped monitoring");
    expect(ended).toContain("stopped monitoring");
    expect(ended).not.toContain("only started monitoring");
  });

  it("returns nothing when there is no trend to caveat", () => {
    // A dangling caveat with no claim attached is its own kind of confusion.
    expect(
      buildTrendDisclosure({
        claimable: 0, coverageStarted: 4, coverageEnded: 0, belowFloor: 9, unknown: 0,
      }),
    ).toBe("");
  });
});

describe("buildClassifierCaveat", () => {
  it("states the rejected count against the raw match count", () => {
    expect(buildClassifierCaveat(1032, 887)).toBe(
      "145 of the 1032 name matches were judged coincidental rather than deliberate, and are excluded from the naming breakdown.",
    );
  });

  it("says nothing when none were rejected", () => {
    expect(buildClassifierCaveat(50, 50)).toBe("");
  });
});

describe("buildTldLine", () => {
  it("quotes the count against the cohort total", () => {
    const s = buildTldLine(
      [
        { key: "online", n: 132 },
        { key: "com", n: 129 },
        { key: "shop", n: 111 },
      ],
      1032,
    );
    expect(s).toBe(
      "372 of 1032 lookalikes were registered on just three domain endings — .online, .com, .shop.",
    );
  });

  it("is silent on empty input rather than emitting a zero", () => {
    expect(buildTldLine([], 0)).toBe("");
  });
});

/**
 * Guards two defects found by GENERATING the real August caption from prod
 * rather than by reading code — neither was covered by any existing test.
 */
describe("published caption copy (regressions found in the live output)", () => {
  it("the mover line never infers an actor from a volume change", async () => {
    const { generateCloneWatchCaption } = await import(
      "@/lib/clone-watch/clone-watch-caption"
    );
    const { JUNE_FIXTURE } = await import("@/__tests__/fixtures/cloneWatchCard");
    const card = {
      ...JUNE_FIXTURE,
      spotlight: {
        kind: "mover" as const,
        brand: "bonds.com.au",
        clones: 28,
        auRank: 1,
        priorClones: 16,
        delta: 12,
      },
    };
    const c = generateCloneWatchCaption(card, "https://askarthur.au/method");
    // "A jump like that usually means one actor registering in bulk" shipped
    // monthly. A month-over-month count says nothing about how many people are
    // behind it — a weaker basis even than the infrastructure fingerprint we
    // already decline to call an actor.
    expect(c.body).not.toMatch(/one actor|coordinated|campaign/i);
  });

  it("states the real watchlist size, not a stale literal", async () => {
    const { generateCloneWatchCaption } = await import(
      "@/lib/clone-watch/clone-watch-caption"
    );
    const { AU_BRAND_WATCHLIST } = await import("@askarthur/shopfront-glue");
    const { JUNE_FIXTURE } = await import("@/__tests__/fixtures/cloneWatchCard");
    const c = generateCloneWatchCaption(JUNE_FIXTURE, "https://askarthur.au/method");
    // The literal said "~50" while the list held 293 — published monthly.
    expect(c.body).not.toContain("~50 major");
    const floor = Math.floor(AU_BRAND_WATCHLIST.length / 10) * 10;
    expect(c.body).toContain(`${floor}+ major Australian brands`);
  });
});
