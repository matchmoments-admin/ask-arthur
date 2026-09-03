import { describe, expect, it } from "vitest";
import type { CloneAlertRow } from "@/app/api/inngest/functions/report-brand-stewardship";
import {
  computeTargetingIntel,
  computeTargetingIntelByBrand,
  hostingConcentration,
  infrastructureClusters,
  intentMix,
  tacticMix,
  tldConcentration,
} from "@/lib/clone-watch/targeting-intelligence";
import { canonicalAsn, isFrontingAsn } from "@/lib/clone-watch/asn-canonical";

function row(over: Partial<CloneAlertRow> & { candidate_domain: string }): CloneAlertRow {
  return {
    id: 1,
    inferred_target_domain: "example.com.au",
    urlscan_classification: null,
    urlscan_evidence: null,
    attribution: null,
    campaign_key: null,
    submitted_to: null,
    ...over,
  } as CloneAlertRow;
}

const clone = (domain: string, tactic: string | null, isClone = true) =>
  row({
    candidate_domain: domain,
    clone_watch_classifications: {
      is_clone: isClone,
      confidence: 0.9,
      attack_intent: null,
      clone_tactic: tactic,
    },
  });

describe("tacticMix", () => {
  it("counts only deliberate clones — a tactic on a coincidence describes nothing", () => {
    const mix = tacticMix([
      clone("nab-secure.shop", "brandjack"),
      clone("nabb.com", "typosquat"),
      clone("dictionary-word.com", "unrelated", false), // is_clone === false
    ]);
    expect(mix.total).toBe(2);
    expect(mix.top).toEqual([
      { key: "brandjack", n: 1 },
      { key: "typosquat", n: 1 },
    ]);
  });

  it("counts a missing tactic as unknown rather than dropping the row", () => {
    const mix = tacticMix([clone("a.com", "typosquat"), clone("b.com", null)]);
    expect(mix.unknown).toBe(1);
    // The invariant that makes a partial-coverage field safe to publish.
    expect(mix.top.reduce((s, t) => s + t.n, 0) + mix.other + mix.unknown).toBe(
      mix.total,
    );
  });
});

describe("intentMix", () => {
  it("counts ONLY scan-corroborated rows", () => {
    // The classifier's whole input is {brand, domain, url} — it never loads the
    // page, so an intent label on an unscanned row is a guess about content
    // nobody saw. Only rows a real scan graded likely_phishing may carry it.
    const mix = intentMix([
      row({
        candidate_domain: "scanned.com",
        urlscan_classification: "likely_phishing",
        clone_watch_classifications: {
          is_clone: true,
          confidence: 0.9,
          attack_intent: "credential_phishing",
          clone_tactic: "brandjack",
        },
      }),
      row({
        candidate_domain: "unscanned.com",
        urlscan_classification: null,
        clone_watch_classifications: {
          is_clone: true,
          confidence: 0.9,
          attack_intent: "payment_fraud",
          clone_tactic: "typosquat",
        },
      }),
      row({
        candidate_domain: "neutral.com",
        urlscan_classification: "neutral",
        clone_watch_classifications: {
          is_clone: true,
          confidence: 0.9,
          attack_intent: "crypto_scam",
          clone_tactic: "typosquat",
        },
      }),
    ]);
    expect(mix.total).toBe(1);
    expect(mix.top).toEqual([{ key: "credential_phishing", n: 1 }]);
  });

  it("treats the literal 'unknown' intent as unknown, not a category", () => {
    const mix = intentMix([
      row({
        candidate_domain: "x.com",
        urlscan_classification: "likely_phishing",
        clone_watch_classifications: {
          is_clone: true,
          confidence: 0.9,
          attack_intent: "unknown",
          clone_tactic: null,
        },
      }),
    ]);
    expect(mix.top).toEqual([]);
    expect(mix.unknown).toBe(1);
  });
});

describe("tldConcentration", () => {
  it("handles two-label AU suffixes", () => {
    const mix = tldConcentration([
      row({ candidate_domain: "fake.com.au" }),
      row({ candidate_domain: "other.com.au" }),
      row({ candidate_domain: "cheap.shop" }),
    ]);
    expect(mix.top[0]).toEqual({ key: "com.au", n: 2 });
  });

  it("dedupes repeated candidate domains", () => {
    const mix = tldConcentration([
      row({ candidate_domain: "dupe.shop" }),
      row({ candidate_domain: "dupe.shop" }),
    ]);
    expect(mix.total).toBe(1);
  });
});

describe("asn canonicalisation and fronting", () => {
  it("normalises ASN spellings", () => {
    expect(canonicalAsn("as13335")).toBe("AS13335");
    expect(canonicalAsn("13335")).toBe("AS13335");
    expect(canonicalAsn(" AS13335 ")).toBe("AS13335");
    expect(canonicalAsn("garbage")).toBeNull();
  });

  it("flags reverse proxies but NOT plain hosting", () => {
    expect(isFrontingAsn("AS13335")).toBe(true); // Cloudflare
    expect(isFrontingAsn("AS20940")).toBe(true); // Akamai
    // A box in Hetzner really is in Hetzner — that is a location.
    expect(isFrontingAsn("AS24940")).toBe(false);
    expect(isFrontingAsn(null)).toBe(false);
  });
});

describe("hostingConcentration — denominators (review findings)", () => {
  it("counts unknown countries by ROWS, not by distinct country", () => {
    // The unknown bucket was `originVisible - countryCounts.size`, i.e. the
    // number of distinct COUNTRIES, not rows. On the real August cohort that
    // reported ~254 unknown of 284 when none were missing, and broke this
    // module's own invariant that top + other + unknown === total.
    const h = hostingConcentration([
      row({ candidate_domain: "a.com", attribution: { hosting: { asn: "AS24940", country: "DE" } } }),
      row({ candidate_domain: "b.com", attribution: { hosting: { asn: "AS24940", country: "DE" } } }),
      row({ candidate_domain: "c.com", attribution: { hosting: { asn: "AS24940", country: "US" } } }),
    ]);
    expect(h.originVisibleN).toBe(3);
    expect(h.countries.unknown).toBe(0);
    const summed =
      h.countries.top.reduce((s, c) => s + c.n, 0) + h.countries.other + h.countries.unknown;
    expect(summed).toBe(h.countries.total);
  });

  it("never publishes an ASN literally named 'Unknown'", () => {
    // A row with a country but no ASN cannot be fronting-checked at all, so it
    // must not be counted as an origin ASN. asnLabel(null) returns "Unknown",
    // which would otherwise rank as a real network.
    const h = hostingConcentration([
      row({ candidate_domain: "a.com", attribution: { hosting: { country: "DE" } } }),
    ]);
    expect(h.asns.top.map((a) => a.key)).not.toContain("Unknown");
    expect(h.asns.unknown).toBe(1);
  });
});

describe("hostingConcentration", () => {
  it("excludes CDN-fronted rows from location claims and counts them", () => {
    const h = hostingConcentration([
      row({
        candidate_domain: "behind-cdn.com",
        attribution: { hosting: { asn: "AS13335", country: "CA" } },
      }),
      row({
        candidate_domain: "real-origin.com",
        attribution: { hosting: { asn: "AS24940", country: "DE" } },
      }),
      row({ candidate_domain: "no-data.com" }),
    ]);
    // "Hosted in Canada" for a Cloudflare edge is the POP, not the operator.
    expect(h.frontedN).toBe(1);
    expect(h.unattributedN).toBe(1);
    expect(h.originVisibleN).toBe(1);
    expect(h.countries.top).toEqual([{ key: "DE", n: 1 }]);
    expect(h.total).toBe(3);
    // Every row is accounted for in exactly one bucket.
    expect(h.frontedN + h.unattributedN + h.originVisibleN).toBe(h.total);
  });

  it("falls back to urlscan server data when attribution is absent", () => {
    const h = hostingConcentration([
      row({
        candidate_domain: "x.com",
        urlscan_evidence: { server: { asn: "AS24940", country: "DE" } },
      }),
    ]);
    expect(h.originVisibleN).toBe(1);
  });
});

describe("infrastructureClusters", () => {
  it("groups by fingerprint and ignores the 'insufficient' sentinel", () => {
    const c = infrastructureClusters([
      row({ candidate_domain: "a.com", campaign_key: "abc123" }),
      row({ candidate_domain: "b.com", campaign_key: "abc123" }),
      // v235 sentinel: fewer than 2 signal components, explicitly NOT a
      // fingerprint. Grouping on it would merge unrelated domains.
      row({ candidate_domain: "c.com", campaign_key: "insufficient" }),
      row({ candidate_domain: "d.com", campaign_key: null }),
    ]);
    expect(c.clusters).toHaveLength(1);
    expect(c.clusters[0].domains).toBe(2);
    expect(c.unfingerprintedN).toBe(2);
    expect(c.fingerprintedN).toBe(2);
    expect(c.largestClusterN).toBe(2);
  });

  it("does not report a cluster of one", () => {
    const c = infrastructureClusters([
      row({ candidate_domain: "solo.com", campaign_key: "unique-key" }),
    ]);
    expect(c.clusters).toEqual([]);
    expect(c.largestClusterN).toBe(0);
  });
});

describe("rows without a candidate domain (review finding)", () => {
  it("keeps them in the denominator instead of vanishing", () => {
    // Dropping them removed them from every total, so the module quietly
    // renormalised until the numbers looked complete — the exact behaviour its
    // header forbids.
    const mix = tldConcentration([
      row({ candidate_domain: "real.shop" }),
      row({ candidate_domain: "" }),
    ]);
    expect(mix.total).toBe(2);
    expect(mix.unknown).toBe(1);
  });
});

describe("computeTargetingIntelByBrand", () => {
  it("keys on inferred_target_domain — the key the monthly stats join on", () => {
    // clone_watch_monthly_brand_stats.brand holds the primary DOMAIN
    // ('apple.com'), which flows from the watchlist's legitimate_domains[0]
    // through the ingest. Keying on a normalised brand name joins to nothing
    // (see migration v295, where that mistake was caught before it shipped).
    const byBrand = computeTargetingIntelByBrand([
      row({ candidate_domain: "appl3.com", inferred_target_domain: "apple.com" }),
      row({ candidate_domain: "amaz0n.com", inferred_target_domain: "amazon.com.au" }),
    ]);
    expect([...byBrand.keys()].sort()).toEqual(["amazon.com.au", "apple.com"]);
  });

  it("skips rows with no brand rather than bucketing them under empty string", () => {
    const byBrand = computeTargetingIntelByBrand([
      row({ candidate_domain: "orphan.com", inferred_target_domain: null }),
    ]);
    expect(byBrand.size).toBe(0);
  });
});

/**
 * The `Mix` contract, asserted as a property over generated input rather than
 * as a hand-picked example.
 *
 * Both denominator bugs review found were violations of the invariant the
 * module's own header states — `top + other + unknown === total` — and both
 * slipped through because every existing case used a fixture whose shape the
 * test author chose. `countries.unknown` counted DISTINCT COUNTRIES rather than
 * rows and passed its test only because that fixture had a single row, where
 * the two coincide.
 *
 * This is the cheap check that catches the class rather than the instance.
 */
describe("Mix invariant holds for arbitrary input", () => {
  const TACTICS = ["typosquat", "brandjack", "compound_word", null];
  const TLDS = ["shop", "online", "com.au", "xyz"];
  const ASNS = ["AS13335", "AS24940", "AS16509", null];
  const COUNTRIES = ["AU", "US", "DE", null];

  /** Deterministic pseudo-random so a failure is reproducible from the seed. */
  function makeRows(seed: number, n: number): CloneAlertRow[] {
    let x = seed;
    const next = (m: number) => (x = (x * 1103515245 + 12345) % 2147483648) % m;
    return Array.from({ length: n }, (_, i) =>
      row({
        candidate_domain: next(7) === 0 ? "" : `d${next(50)}-${i}.${TLDS[next(TLDS.length)]}`,
        inferred_target_domain: next(9) === 0 ? null : "brand.com.au",
        urlscan_classification: next(3) === 0 ? "likely_phishing" : "neutral",
        campaign_key: next(4) === 0 ? "insufficient" : `key${next(5)}`,
        attribution: {
          hosting: {
            asn: ASNS[next(ASNS.length)] ?? undefined,
            country: COUNTRIES[next(COUNTRIES.length)] ?? undefined,
          },
        },
        clone_watch_classifications: {
          is_clone: next(5) !== 0,
          confidence: 0.9,
          attack_intent: next(2) === 0 ? "credential_phishing" : "unknown",
          clone_tactic: TACTICS[next(TACTICS.length)],
        },
      }),
    );
  }

  const sums = (m: { top: Array<{ n: number }>; other: number; unknown: number }) =>
    m.top.reduce((s, t) => s + t.n, 0) + m.other + m.unknown;

  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`seed ${seed}: every distribution sums to its own total`, () => {
      const rows = makeRows(seed, 60);
      const intel = computeTargetingIntel(rows);
      expect(sums(intel.tactics)).toBe(intel.tactics.total);
      expect(sums(intel.tlds)).toBe(intel.tlds.total);
      expect(sums(intel.intents)).toBe(intel.intents.total);
      expect(sums(intel.hosting.asns)).toBe(intel.hosting.asns.total);
      expect(sums(intel.hosting.countries)).toBe(intel.hosting.countries.total);
    });

    it(`seed ${seed}: hosting buckets partition every row exactly once`, () => {
      const h = computeTargetingIntel(makeRows(seed, 60)).hosting;
      expect(h.frontedN + h.unattributedN + h.originVisibleN).toBe(h.total);
    });

    it(`seed ${seed}: cluster denominators partition every row`, () => {
      const c = computeTargetingIntel(makeRows(seed, 60)).clusters;
      expect(c.fingerprintedN + c.unfingerprintedN).toBe(c.total);
    });

    it(`seed ${seed}: no distribution exceeds the cohort it was drawn from`, () => {
      const rows = makeRows(seed, 60);
      const intel = computeTargetingIntel(rows);
      // Deliberate clones and scan-corroborated rows are both subsets.
      expect(intel.tactics.total).toBeLessThanOrEqual(intel.tlds.total);
      expect(intel.intents.total).toBeLessThanOrEqual(intel.tlds.total);
    });
  }
});
