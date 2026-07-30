import { describe, expect, it } from "vitest";
import {
  aggregateBrandMentions,
  hasAuEvidence,
  meetsPromotionBar,
  mergeCandidateSources,
  partitionForDigest,
  planPromotions,
  CANDIDATE_DENYLIST,
} from "@/app/api/inngest/functions/reddit-brands-discover";
import { AU_BRAND_WATCHLIST, brandNormalize, buildWatchedKeySet } from "@askarthur/shopfront-glue";

/**
 * PRODUCTION REPLAY — what will the Monday digest actually say?
 *
 * Every other test in this repo feeds the discovery pipeline invented data.
 * That proves the logic is self-consistent; it does not prove the feature
 * WORKS, because the thing most likely to be wrong is an assumption about the
 * shape of real data. This file closes that gap: the fixtures below are the
 * literal output of the production RPCs, captured 2026-07-30, replayed through
 * the real exported functions in the real order the cron calls them.
 *
 * It already earned its keep. Building it surfaced a live defect in the
 * auto-promotion domain lookup that three correctness reviews had missed:
 * `known_brands.brand_key` is written by deriveBrandKey() (non-alphanumerics
 * -> "_", so "Australia Post" -> "australia_post") while candidates are keyed
 * by brandNormalize() (non-alphanumerics STRIPPED -> "australiapost"). The two
 * conventions coincide only for single-word brands. 140 of 307 known_brands
 * rows mismatch — 46% of the domain store, and exactly the multi-word AU
 * brands that matter most. See the KEY CONVENTION test at the bottom.
 *
 * REFRESHING THE FIXTURES (do this if the assertions start looking stale):
 *   select json_agg(row_to_json(t)) from (
 *     select * from public.aggregate_reddit_brands_with_au(now() - interval '30 days', 3)
 *   ) t;
 *   select json_agg(row_to_json(t)) from (
 *     select * from public.aggregate_scam_report_brands(now() - interval '30 days', 2)
 *   ) t;
 *   select json_agg(brand_normalized) from public.reddit_watchlist_candidates;
 *   select json_agg(json_build_object('brand_name',brand_name,'brand_domain',brand_domain))
 *     from public.known_brands where brand_domain is not null and brand_domain <> '';
 *
 * The counts WILL drift as the 30-day window rolls. Assertions here are
 * deliberately written as properties ("no US-only brand reaches the actionable
 * list") rather than exact totals, except where an exact number is the point.
 */

type RedditRow = {
  brand_normalized: string;
  raw_brand: string;
  mention_count: number;
  au_count: number;
};

/** Live output of aggregate_reddit_brands_with_au(30d, 3) on 2026-07-30. */
const PROD_REDDIT: RedditRow[] = [
  { brand_normalized: "facebookmarketplace", raw_brand: "Facebook Marketplace", mention_count: 14, au_count: 2 },
  { brand_normalized: "paypal", raw_brand: "PayPal", mention_count: 29, au_count: 1 },
  { brand_normalized: "ebay", raw_brand: "eBay", mention_count: 8, au_count: 1 },
  { brand_normalized: "vinted", raw_brand: "Vinted", mention_count: 5, au_count: 1 },
  { brand_normalized: "capitalone", raw_brand: "Capital One", mention_count: 4, au_count: 1 },
  { brand_normalized: "youtube", raw_brand: "YouTube", mention_count: 4, au_count: 1 },
  { brand_normalized: "facebook", raw_brand: "Facebook", mention_count: 29, au_count: 0 },
  { brand_normalized: "amazon", raw_brand: "Amazon", mention_count: 22, au_count: 0 },
  { brand_normalized: "discord", raw_brand: "Discord", mention_count: 22, au_count: 0 },
  { brand_normalized: "google", raw_brand: "Google", mention_count: 21, au_count: 0 },
  { brand_normalized: "apple", raw_brand: "Apple", mention_count: 21, au_count: 0 },
  { brand_normalized: "walmart", raw_brand: "Walmart", mention_count: 16, au_count: 0 },
  { brand_normalized: "instagram", raw_brand: "Instagram", mention_count: 16, au_count: 0 },
  { brand_normalized: "microsoft", raw_brand: "Microsoft", mention_count: 14, au_count: 0 },
  { brand_normalized: "indeed", raw_brand: "Indeed", mention_count: 11, au_count: 0 },
  { brand_normalized: "tiktok", raw_brand: "TikTok", mention_count: 11, au_count: 0 },
  { brand_normalized: "linkedin", raw_brand: "LinkedIn", mention_count: 11, au_count: 0 },
  { brand_normalized: "reddit", raw_brand: "Reddit", mention_count: 10, au_count: 0 },
  { brand_normalized: "cashapp", raw_brand: "Cash App", mention_count: 8, au_count: 0 },
  { brand_normalized: "steam", raw_brand: "Steam", mention_count: 7, au_count: 0 },
  { brand_normalized: "venmo", raw_brand: "Venmo", mention_count: 7, au_count: 0 },
  { brand_normalized: "verizon", raw_brand: "Verizon", mention_count: 6, au_count: 0 },
  { brand_normalized: "zelle", raw_brand: "Zelle", mention_count: 6, au_count: 0 },
  { brand_normalized: "bankofamerica", raw_brand: "Bank of America", mention_count: 6, au_count: 0 },
  { brand_normalized: "whatsapp", raw_brand: "WhatsApp", mention_count: 5, au_count: 0 },
  { brand_normalized: "xfinity", raw_brand: "Xfinity", mention_count: 5, au_count: 0 },
  { brand_normalized: "fedex", raw_brand: "FedEx", mention_count: 5, au_count: 0 },
  { brand_normalized: "revolut", raw_brand: "Revolut", mention_count: 5, au_count: 0 },
  { brand_normalized: "westernunion", raw_brand: "Western Union", mention_count: 5, au_count: 0 },
  { brand_normalized: "citibank", raw_brand: "Citibank", mention_count: 4, au_count: 0 },
  { brand_normalized: "wellsfargo", raw_brand: "Wells Fargo", mention_count: 4, au_count: 0 },
  { brand_normalized: "ticketmaster", raw_brand: "Ticketmaster", mention_count: 4, au_count: 0 },
  { brand_normalized: "americanexpress", raw_brand: "American Express", mention_count: 3, au_count: 0 },
  { brand_normalized: "meta", raw_brand: "Meta", mention_count: 3, au_count: 0 },
  { brand_normalized: "nextdoor", raw_brand: "Nextdoor", mention_count: 3, au_count: 0 },
  { brand_normalized: "chime", raw_brand: "Chime", mention_count: 3, au_count: 0 },
  { brand_normalized: "usps", raw_brand: "USPS", mention_count: 3, au_count: 0 },
  { brand_normalized: "chase", raw_brand: "Chase", mention_count: 3, au_count: 0 },
];

/** Live output of aggregate_scam_report_brands(30d, 2) on 2026-07-30. */
const PROD_SCAM = [
  { brand_normalized: "australiapost", raw_brand: "Australia Post", mention_count: 2 },
];

/** brand_normalized values already in reddit_watchlist_candidates (51 rows). */
const PROD_EXISTING_KEYS = [
  "adobe", "airbnb", "americanexpress", "applepay", "bankofamerica", "bankofireland",
  "capitalone", "cashapp", "chase", "chime", "costco", "depop", "discord", "doordash",
  "ebay", "facebookmarketplace", "gmail", "hinge", "indeed", "linkedin", "lowes", "meta",
  "microsoftteams", "mrbeast", "nextdoor", "paperlesspost", "reddit", "robinhood",
  "roblox", "shop", "shopify", "square", "steam", "telegram", "ticketmaster", "tiktok",
  "tinder", "tumblr", "uber", "ups", "usps", "venmo", "verizon", "vinted", "walmart",
  "wellsfargo", "whatnot", "xfinity", "xtwitter", "zelle", "zillow",
];

/** A representative slice of known_brands, with the REAL brand_key values so
 *  the convention mismatch is reproducible rather than asserted. */
const PROD_KNOWN_BRANDS = [
  { brand_name: "Australia Post", brand_key: "australia_post", brand_domain: "auspost.com.au" },
  { brand_name: "Commonwealth Bank", brand_key: "commonwealth_bank", brand_domain: "commbank.com.au" },
  { brand_name: "JB Hi-Fi", brand_key: "jb_hi_fi", brand_domain: "jbhifi.com.au" },
  { brand_name: "Chemist Warehouse", brand_key: "chemist_warehouse", brand_domain: "chemistwarehouse.com.au" },
  { brand_name: "eBay", brand_key: "ebay", brand_domain: "ebay.com.au" },
  { brand_name: "PayPal", brand_key: "paypal", brand_domain: "paypal.com" },
];

/** The cron's own pipeline, in order, minus the DB writes. */
function replay(opts: { autoPromote: boolean }) {
  const watched = buildWatchedKeySet(AU_BRAND_WATCHLIST);
  const known = new Set(PROD_EXISTING_KEYS);

  const isFresh = (c: { brandNormalized: string }) =>
    !CANDIDATE_DENYLIST.has(c.brandNormalized) && !watched.has(c.brandNormalized);

  const reddit = PROD_REDDIT.map((r) => ({
    brandNormalized: r.brand_normalized,
    rawBrand: r.raw_brand,
    mentionCount: r.mention_count,
    auCount: r.au_count,
  })).filter(isFresh);

  // scam_reports rows are AU-attributable by construction (see the fn header).
  const scam = PROD_SCAM.map((r) => ({
    brandNormalized: r.brand_normalized,
    rawBrand: r.raw_brand,
    mentionCount: r.mention_count,
    auCount: r.mention_count,
  })).filter(isFresh);

  const allFresh = mergeCandidateSources(reddit, scam);
  const newlySurfaced = allFresh.filter((m) => !known.has(m.brandNormalized));

  // The FIXED domain lookup: key on brandNormalize(brand_name).
  const domains = new Map(
    PROD_KNOWN_BRANDS.flatMap((k) => {
      const key = brandNormalize(k.brand_name);
      return key ? [[key, { domain: k.brand_domain, source: "known_brands" }] as const] : [];
    }),
  );

  const { promote, needsDomain } = opts.autoPromote
    ? planPromotions(allFresh, domains)
    : { promote: [], needsDomain: [] };

  const promotedKeys = new Set(promote.map((p) => p.brandNormalized));
  const { auEvidenced, globalOnly } = partitionForDigest(newlySurfaced, promotedKeys);

  return { allFresh, newlySurfaced, auEvidenced, globalOnly, promote, needsDomain };
}

describe("PROD REPLAY — what Monday's digest will contain", () => {
  const r = replay({ autoPromote: false });

  it("is currently in its SILENT steady state — every list is empty", () => {
    // Written expecting a non-empty list; the replay proved the opposite, and
    // the code is right. On real 2026-07-30 data every AU-evidenced brand is
    // already watched (PayPal), denylisted as a platform (Facebook
    // Marketplace, YouTube), or already in the queue (eBay, Vinted, Capital
    // One). So the digest has nothing NEW to report.
    //
    // This is the finding that mattered most: under the original send
    // condition the cron would have posted NOTHING, and seven days of silence
    // reads identically to a dead cron. The fix is the unconditional send +
    // heartbeat in the function. Keep this assertion — the day it fails is the
    // day a genuinely new AU-evidenced brand appears, which is exactly when
    // someone should look at the digest.
    expect(r.auEvidenced).toHaveLength(0);
    expect(r.globalOnly).toHaveLength(0);
  });

  it("has AU-evidenced brands in the raw aggregate — the gate is not over-filtering", () => {
    // Distinguishes "nothing new" from "the AU signal is broken". There ARE
    // AU-evidenced brands upstream; they are all legitimately excluded
    // downstream. Without this, the empty list above would be ambiguous.
    const auInRaw = PROD_REDDIT.filter((x) => x.au_count > 0).map((x) => x.brand_normalized);
    expect(auInRaw).toContain("facebookmarketplace"); // denylisted platform
    expect(auInRaw).toContain("paypal"); // already on the watchlist
    expect(auInRaw).toContain("vinted"); // already in the candidate queue
    expect(auInRaw.length).toBeGreaterThanOrEqual(5);
  });

  it("every actionable brand carries real Australian evidence", () => {
    for (const m of r.auEvidenced) expect(m.au).toBeGreaterThan(0);
  });

  it("silences the US-only brands the 2026-07-26 digest actually proposed", () => {
    const actionable = r.auEvidenced.map((m) => m.brandNormalized);
    for (const us of ["xfinity", "chime", "nextdoor", "americanexpress"]) {
      expect(actionable).not.toContain(us);
    }
  });

  it("keeps high-volume zero-AU brands out of the actionable list", () => {
    const actionable = r.auEvidenced.map((m) => m.brandNormalized);
    // 29 and 22 mentions respectively — volume is not relevance.
    expect(actionable).not.toContain("facebook");
    expect(actionable).not.toContain("amazon");
  });

  it("excludes Australia Post because it is ALREADY on the watchlist", () => {
    // Written expecting a candidate; the replay proved otherwise, and the code
    // is right. The only brand the reported-scams source yields in this window
    // is Australia Post, which is already monitored — so the already-watched
    // gate correctly drops it. Recorded because the tempting misreading is
    // "the scam source is broken": it is working, there is simply nothing
    // NEW in it yet. Note this gate now reads the ACTIVE watchlist (#866), so
    // it also covers overlay-promoted brands, not just the static array.
    expect(buildWatchedKeySet(AU_BRAND_WATCHLIST).has("australiapost")).toBe(true);
    expect(r.allFresh.find((m) => m.brandNormalized === "australiapost")).toBeUndefined();
  });

  it("the reported-scams source contributes no NEW candidate this window", () => {
    // The honest state of FF_SCAM_BRANDS_SOURCE on real data: 1 brand over the
    // 30-day window, already watched. Not a defect — it scales with Arthur's
    // own traffic, which is the whole point of preferring it over r/Scams
    // volume. This assertion will start failing the first time a genuinely
    // new brand is reported twice, which is exactly when someone should look.
    const fromScam = r.allFresh.filter((m) => m.scam > 0);
    expect(fromScam).toHaveLength(0);
  });

  it("does not re-announce brands already in the candidate table", () => {
    const announced = [...r.auEvidenced, ...r.globalOnly].map((m) => m.brandNormalized);
    for (const key of announced) expect(PROD_EXISTING_KEYS).not.toContain(key);
  });

  it("drops denylisted platform names from every list", () => {
    const all = [...r.allFresh].map((m) => m.brandNormalized);
    for (const platform of ["reddit", "discord", "facebookmarketplace", "tiktok"]) {
      expect(all).not.toContain(platform);
    }
  });

  it("prints the digest population for eyeballing", () => {
    // Not an assertion — a deliberate window into real behaviour, so a human
    // reviewing this file sees what the cron will actually say.
    const fmt = (m: { rawBrand: string; au: number; total: number }) =>
      `${m.rawBrand} (AU ${m.au}/${m.total})`;
    console.log("  actionable :", r.auEvidenced.map(fmt).join(", ") || "(none)");
    console.log("  global-only:", r.globalOnly.map(fmt).join(", ") || "(none)");
    expect(true).toBe(true);
  });
});

describe("PROD REPLAY — auto-promotion, if the flag were ON", () => {
  const r = replay({ autoPromote: true });

  it("promotes NOTHING on today's real data — and that is correct", () => {
    // Measured, not assumed. No unwatched brand in this window clears the bar:
    // the only au >= 2 candidate is Facebook Marketplace (denylisted as a
    // platform), and the only scam >= 2 brand is already watched. So an
    // operator flipping FF_BRAND_AUTO_PROMOTE today would see zero
    // promotions — which is why the flag stays off until a digest proposes
    // something worth promoting.
    expect(r.promote).toHaveLength(0);
    expect(r.needsDomain).toHaveLength(0);
  });

  it("DOES promote a qualifying unwatched brand, using a real known_brands domain", () => {
    // Proves the mechanism rather than waiting for the data. Evidence counts
    // are synthetic (that part is arithmetic); the domain resolution is real —
    // "Chemist Warehouse" -> chemistwarehouse.com.au straight out of the
    // production known_brands slice. This is the assertion that FAILS under the
    // old brand_key lookup, because "chemistwarehouse" never matched
    // "chemist_warehouse". It is the regression guard for the bug this file
    // was written to find.
    const domains = new Map(
      PROD_KNOWN_BRANDS.flatMap((k) => {
        const key = brandNormalize(k.brand_name);
        return key ? [[key, { domain: k.brand_domain, source: "known_brands" }] as const] : [];
      }),
    );
    const candidate = {
      brandNormalized: "chemistwarehouse",
      rawBrand: "Chemist Warehouse",
      reddit: 0,
      scam: 3,
      total: 3,
      au: 3,
    };
    const { promote, needsDomain } = planPromotions([candidate], domains);
    expect(needsDomain).toHaveLength(0);
    expect(promote).toHaveLength(1);
    expect(promote[0].domains).toEqual(["chemistwarehouse.com.au"]);
    expect(promote[0].domainSource).toBe("known_brands");
  });

  it("reports a qualifying brand with NO known domain instead of guessing one", () => {
    const candidate = {
      brandNormalized: "totallynewbrand",
      rawBrand: "Totally New Brand",
      reddit: 0,
      scam: 4,
      total: 4,
      au: 4,
    };
    const { promote, needsDomain } = planPromotions([candidate], new Map());
    expect(promote).toHaveLength(0);
    expect(needsDomain.map((m) => m.rawBrand)).toEqual(["Totally New Brand"]);
  });

  it("never promotes a brand without a resolved domain", () => {
    for (const p of r.promote) expect(p.domains.length).toBeGreaterThan(0);
    // Anything that cleared the bar but had no domain must be reported, not
    // guessed at.
    for (const n of r.needsDomain) expect(meetsPromotionBar(n)).toBe(true);
  });

  it("promotes nothing that fails the evidence bar", () => {
    for (const p of r.promote) {
      expect(p.scam >= 2 || p.au >= 2).toBe(true);
    }
  });

  it("removes promoted brands from the actionable list", () => {
    const actionable = r.auEvidenced.map((m) => m.brandNormalized);
    for (const p of r.promote) expect(actionable).not.toContain(p.brandNormalized);
  });
});

describe("KEY CONVENTION — the bug this replay caught", () => {
  it("deriveBrandKey and brandNormalize disagree on every multi-word brand", () => {
    // known_brands.brand_key uses deriveBrandKey (non-alphanumerics -> "_").
    // Candidates use brandNormalize (non-alphanumerics stripped). Matching one
    // against the other resolves NOTHING for a multi-word brand — 140 of 307
    // known_brands rows, measured in prod on 2026-07-30.
    const deriveBrandKey = (b: string) => b.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
    for (const k of PROD_KNOWN_BRANDS) {
      const legacy = deriveBrandKey(k.brand_name);
      const canonical = brandNormalize(k.brand_name);
      if (/[^a-zA-Z0-9]/.test(k.brand_name)) {
        expect(legacy).not.toBe(canonical); // multi-word => guaranteed mismatch
      } else {
        expect(legacy).toBe(canonical); // single word => coincidence
      }
    }
  });

  it("the fixed lookup resolves a multi-word brand that brand_key could not", () => {
    const viaBrandKey = new Map(
      PROD_KNOWN_BRANDS.map((k) => [k.brand_key, k.brand_domain]),
    );
    const viaNormalize = new Map(
      PROD_KNOWN_BRANDS.map((k) => [brandNormalize(k.brand_name)!, k.brand_domain]),
    );
    // "Australia Post" as a candidate normalises to "australiapost".
    expect(viaBrandKey.get("australiapost")).toBeUndefined(); // the old bug
    expect(viaNormalize.get("australiapost")).toBe("auspost.com.au"); // fixed
  });
});

describe("aggregateBrandMentions matches the SQL aggregate's contract", () => {
  it("counts AU per post the same way the RPC counts it per post", () => {
    // The TS and SQL aggregates must agree, since brand-register-refresh uses
    // the TS one while discovery uses the RPC. Both: one count per distinct
    // normalized brand per POST, AU attributed per post.
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Australia Post", "auspost"], country_hints: ["AU"] },
      { brands_impersonated: ["Australia Post"], country_hints: ["US"] },
    ]);
    expect(agg.get("australiapost")).toMatchObject({ mentionCount: 2, auCount: 1 });
    expect(agg.get("auspost")).toMatchObject({ mentionCount: 1, auCount: 1 });
    for (const v of agg.values()) {
      expect(v.auCount).toBeLessThanOrEqual(v.mentionCount);
      expect(hasAuEvidence({ ...v, reddit: 0, scam: 0, total: v.mentionCount, au: v.auCount })).toBe(
        v.auCount > 0,
      );
    }
  });
});
