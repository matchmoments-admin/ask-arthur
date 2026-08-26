import { describe, expect, it } from "vitest";
import {
  aggregateBrandMentions,
  buildDigestMessage,
  hasAuEvidence,
  meetsPromotionBar,
  mergeCandidateSources,
  partitionForDigest,
  planPromotions,
  buildFreshCandidateGate,
  CANDIDATE_DENYLIST,
} from "@/app/api/inngest/functions/reddit-brands-discover";
import {
  AU_BRAND_WATCHLIST,
  brandNormalize,
  buildBrandResolver,
  buildBrandMultiResolver,
  buildWatchedKeySet,
} from "@askarthur/shopfront-glue";

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
  { brand_normalized: "googleplay", raw_brand: "Google Play", mention_count: 3, au_count: 0 },
  { brand_normalized: "gmail", raw_brand: "Gmail", mention_count: 3, au_count: 0 },
  { brand_normalized: "nextdoor", raw_brand: "Nextdoor", mention_count: 3, au_count: 0 },
  { brand_normalized: "adobe", raw_brand: "Adobe", mention_count: 3, au_count: 0 },
  { brand_normalized: "telegram", raw_brand: "Telegram", mention_count: 3, au_count: 0 },
  { brand_normalized: "chime", raw_brand: "Chime", mention_count: 3, au_count: 0 },
  { brand_normalized: "tinder", raw_brand: "Tinder", mention_count: 3, au_count: 0 },
  { brand_normalized: "usps", raw_brand: "USPS", mention_count: 3, au_count: 0 },
  { brand_normalized: "zillow", raw_brand: "Zillow", mention_count: 3, au_count: 0 },
  { brand_normalized: "chase", raw_brand: "Chase", mention_count: 3, au_count: 0 },
  { brand_normalized: "whatnot", raw_brand: "Whatnot", mention_count: 3, au_count: 0 },
];

/**
 * The v174 alias layer, as the cron loads it (loadAliasRecord -> a plain
 * Record). Only the entries touching brands in this window; the live table has
 * 311 rows.
 *
 * The bottom block is v260. The already-watched gate is EXACT set membership on
 * brandNormalize(), but the upstream classifier emits free text, so a label like
 * "Australian Tax Office (ATO)" normalises to `australiantaxofficeato` and does
 * NOT equal the watchlist's `australiantaxationoffice`. Without an alias the
 * gate leaks and an already-watched brand is proposed as a new candidate. This
 * is the same shape as #878's brand_key bug — two key conventions that coincide
 * only by accident — one layer up.
 */
const PROD_ALIASES: Record<string, string> = {
  amazon: "Amazon",
  apple: "Apple",
  australiapost: "Australia Post",
  citibank: "Citibank",
  // NOTE: `ebay` deliberately does NOT appear here — it lives in the v261 block
  // below, pointing at "eBay Australia". Its pre-v261 value WAS `"eBay"`, which
  // is precisely the self-referential row that bridged nothing.
  facebook: "Facebook",
  fedex: "FedEx",
  google: "Google",
  // Verified present in prod brand_aliases 2026-08-27. `nab` is source
  // 'watchlist'; `nationalaustraliabank` was added by hand on 2026-06-01. Both
  // are here because the NAB fix depends on them EXISTING — the fragment pass
  // resolves "NAB (National Australia Bank)" only because one of its fragments
  // is a real alias row. Without these two lines the harness fails, which is
  // the correct behaviour: it would mean the fix rests on data we do not have.
  nab: "NAB",
  nationalaustraliabank: "NAB",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  meta: "Meta",
  microsoft: "Microsoft",
  paypal: "PayPal",
  revolut: "Revolut",
  telstra: "Telstra",
  westernunion: "Western Union",
  whatsapp: "WhatsApp",
  // v260 — classifier free-text variants of brands ALREADY on the watchlist.
  anzbank: "ANZ",
  australiantaxofficeato: "Australian Taxation Office",
  googleaustralia: "Google",
  googleplay: "Google",
  instagrammeta: "Instagram",
  metafacebook: "Facebook",
  appleincicloud: "Apple",
  mygovaustraliangovernment: "myGov",
  // v261 — the SUFFIXED-LABEL leak, the mirror image of the v260 block above.
  // There the classifier's label was longer than the watchlist's; here the
  // watchlist's is longer. "eBay Australia" normalises to `ebayaustralia` but
  // the classifier only ever emits `ebay`, so a brand we already monitor was
  // sitting at the TOP of the review queue with AU evidence. Note these point
  // at the exact watchlist LABEL — the pre-v261 rows were self-referential
  // (`ebay -> "eBay"`), which satisfies "an alias exists" while bridging
  // nothing.
  ebay: "eBay Australia",
  netflix: "Netflix (AU)",
  binance: "Binance Australia",
  spotify: "Spotify (AU)",
  disney: "Disney+ (AU)",
  foxtel: "Foxtel / Kayo",
  kayo: "Foxtel / Kayo",
  ing: "ING Australia",
  linkt: "Linkt (Transurban)",
  opal: "Opal (Transport for NSW)",
  translink: "Translink (Queensland)",
  myki: "myki (Public Transport Victoria)",
};

/** Live output of aggregate_scam_report_brands(30d, 2) on 2026-07-30. */
/**
 * The COMPLETE result of aggregate_scam_report_brands(now()-30d, 2), captured
 * 2026-08-27. Refreshed wholesale from the RPC, never hand-transcribed — the
 * 2026-07-30 pass lost 7 of 45 rows that way and inverted this harness's
 * headline prediction.
 *
 * Both rows are the reason this PR exists. `nabnationalaustraliabank` is NAB,
 * monitored since the static list was written, leaked by a compound label; the
 * other is a charity that returns zero matches against acnc_charities.
 */
const PROD_SCAM = [
  {
    brand_normalized: "nabnationalaustraliabank",
    raw_brand: "NAB (National Australia Bank)",
    mention_count: 2,
  },
  {
    brand_normalized: "schoolaustraliacancerrelieffund",
    raw_brand: "School / Australia Cancer Relief Fund",
    mention_count: 2,
  },
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
  const resolveCanonical = buildBrandResolver(PROD_ALIASES);

  // The REAL gate, imported — not a hand-written mirror of it.
  //
  // This used to be a copy of isFreshCandidate()'s body, and the copy had
  // already drifted once: an earlier version omitted the alias second-chance,
  // which is exactly the leak v260 closed, so the harness could observe neither
  // that bug nor its fix. A regression harness that re-implements the thing it
  // guards can only ever prove the copy correct. buildFreshCandidateGate() was
  // extracted so both sides run the same code.
  const isFresh = buildFreshCandidateGate({
    watched,
    resolveCanonical,
    resolveMulti: buildBrandMultiResolver(PROD_ALIASES),
  });

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

  it("proposes no brand that is already watched, aliased to a watched brand, or denylisted", () => {
    // THE property, replacing an earlier assertion that both lists were empty.
    //
    // That assertion was a point-in-time FACT dressed as a property, and it went
    // stale within hours: the fixture it was written against captured 38 of the
    // 45 rows the live RPC returns, and one of the 7 dropped rows —
    // `googleplay` — was the only brand in the window that is net-new, not
    // denylisted and not watched. So the harness reported "global-only: (none)"
    // and the handoff predicted a heartbeat-only digest, when the real cron
    // would have named Google Play and SUPPRESSED the heartbeat (which was
    // conditional on every list being empty).
    //
    // The lesson is about test design, not about this brand: assert what must
    // always be true, and let the counts drift. "No already-covered brand is
    // ever proposed" is the invariant the feature actually owes the operator.
    const watched = buildWatchedKeySet(AU_BRAND_WATCHLIST);
    const resolveCanonical = buildBrandResolver(PROD_ALIASES);
    for (const m of [...r.auEvidenced, ...r.globalOnly]) {
      expect(CANDIDATE_DENYLIST.has(m.brandNormalized)).toBe(false);
      expect(watched.has(m.brandNormalized)).toBe(false);
      const canonical = resolveCanonical(m.rawBrand);
      if (canonical) expect(watched.has(brandNormalize(canonical)!)).toBe(false);
    }
  });

  it("v260: the classifier's free-text variants resolve to their watched canonical", () => {
    // Each of these is a real label seen in production data whose normalised key
    // does NOT equal its watchlist key. Without the alias they surface as
    // brand-new candidates for brands already covered; `australiantaxofficeato`
    // and `googleaustralia` additionally clear the auto-promotion bar (scam >= 2)
    // at a 90-day window, so this is the gate that keeps them out.
    const watched = buildWatchedKeySet(AU_BRAND_WATCHLIST);
    const resolveCanonical = buildBrandResolver(PROD_ALIASES);
    for (const [raw, key] of [
      ["Australian Tax Office (ATO)", "australiantaxofficeato"],
      ["Google Australia", "googleaustralia"],
      ["Google Play", "googleplay"],
      ["Instagram / Meta", "instagrammeta"],
      ["Meta/Facebook", "metafacebook"],
      ["Apple Inc. / iCloud", "appleincicloud"],
      ["myGov (Australian Government)", "mygovaustraliangovernment"],
    ] as const) {
      expect(brandNormalize(raw)).toBe(key);
      // The variant key itself is NOT on the watchlist — that is the leak.
      expect(watched.has(key)).toBe(false);
      // …but its canonical is, so the alias second-chance closes it.
      const canonical = resolveCanonical(raw);
      expect(canonical).toBeTruthy();
      expect(watched.has(brandNormalize(canonical)!)).toBe(true);
    }
  });

  it("v261: eBay is recognised as already watched, through the whole real gate", () => {
    // The bug an operator actually hit: eBay was the TOP row of
    // /admin/brand-candidates with AU evidence — the obvious brand to promote —
    // while already being monitored as "eBay Australia". Promoting it would have
    // created a second overlapping entry for a covered brand.
    //
    // Note the direct check does NOT catch it: `ebay` is genuinely absent from
    // buildWatchedKeySet, because the watchlist label normalises to
    // `ebayaustralia`. Only the alias second-chance closes it, which is exactly
    // why the pre-v261 self-referential row (`ebay -> "eBay"`) bridged nothing.
    const watched = buildWatchedKeySet(AU_BRAND_WATCHLIST);
    expect(watched.has("ebay")).toBe(false);
    expect(watched.has("ebayaustralia")).toBe(true);

    const resolveCanonical = buildBrandResolver(PROD_ALIASES);
    const canonical = resolveCanonical("eBay");
    expect(canonical).toBe("eBay Australia");
    expect(watched.has(brandNormalize(canonical)!)).toBe(true);

    // …and therefore it never reaches the queue.
    expect(r.allFresh.find((m) => m.brandNormalized === "ebay")).toBeUndefined();
  });

  it("v261 bridges are not self-referential", () => {
    // The failure mode that made this leak invisible for so long: an alias row
    // existed for `ebay`, so any audit asking "is there an alias?" said yes —
    // but it pointed at "eBay", which normalises straight back to the unwatched
    // key. A bridge to yourself is not a bridge.
    for (const key of ["ebay", "netflix", "binance", "spotify", "disney", "ing"]) {
      const target = PROD_ALIASES[key];
      expect(target, `${key} has no v261 bridge`).toBeTruthy();
      expect(brandNormalize(target), `${key} bridges to itself`).not.toBe(key);
    }
  });

  it("Google Play is filtered by the v260 alias, not by luck", () => {
    // The concrete case from the bug above: present in the live aggregate at 3
    // mentions, absent from the candidate queue, absent from the denylist, and
    // `googleplay` !== `google` so the direct watched check does not catch it.
    // Only the alias does. If this alias is ever dropped, the brand returns to
    // the digest and the heartbeat regression returns with it.
    expect(PROD_REDDIT.some((x) => x.brand_normalized === "googleplay")).toBe(true);
    expect(PROD_EXISTING_KEYS).not.toContain("googleplay");
    expect(CANDIDATE_DENYLIST.has("googleplay")).toBe(false);
    expect(buildWatchedKeySet(AU_BRAND_WATCHLIST).has("googleplay")).toBe(false);
    expect(r.allFresh.find((m) => m.brandNormalized === "googleplay")).toBeUndefined();
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

  it("excludes NAB even though the label never matches its keys", () => {
    // THE REGRESSION. This is the 2026-08-24 digest bug, replayed on the exact
    // prod row that produced it.
    //
    // NAB is monitored (au-brand-watchlist.ts, nab.com.au) and has TWO alias
    // rows, `nab` and `nationalaustraliabank`. The candidate key is
    // `nabnationalaustraliabank` — the classifier's parenthetical, normalised
    // whole. It matches the watchlist key: no. Either alias: no. So all three
    // pre-2026-08-27 checks passed it through, it cleared the promotion bar on
    // two AU reports, and the digest offered a brand we already watch as ready
    // to promote.
    //
    // Asserted as a PROPERTY of the gate, not of this window's contents: the
    // three negatives below are what make the fourth check load-bearing, so a
    // future refactor that drops it fails here rather than in production.
    const watched = buildWatchedKeySet(AU_BRAND_WATCHLIST);
    expect(watched.has("nab")).toBe(true);
    expect(watched.has("nabnationalaustraliabank")).toBe(false);
    expect(PROD_ALIASES["nabnationalaustraliabank"]).toBeUndefined();
    expect(buildBrandResolver(PROD_ALIASES)("NAB (National Australia Bank)")).toBeNull();

    expect(
      r.allFresh.find((m) => m.brandNormalized === "nabnationalaustraliabank"),
    ).toBeUndefined();
  });

  it("still surfaces a genuinely unknown brand from the same window", () => {
    // The other half of the property, and the reason the fix is not simply
    // "drop anything with a bracket in it". The Cancer Relief Fund row has the
    // same compound shape as NAB and resolves to nothing, so it must still
    // reach the operator. A gate that suppressed both would be silently worse
    // than the leak it replaced.
    expect(
      r.allFresh.find((m) => m.brandNormalized === "schoolaustraliacancerrelieffund"),
    ).toBeDefined();
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

  it("prints the ACTUAL Telegram message this data produces", () => {
    // The population above is the input; this is the artefact an operator
    // actually reads on a Monday morning. Printing it is how the suppressed
    // heartbeat would have been caught by eye rather than by reasoning about
    // `nothingAtAll` — the digest population looked fine, the MESSAGE was
    // missing its most important line.
    const msg = buildDigestMessage({
      auEvidenced: r.auEvidenced,
      globalOnly: r.globalOnly,
      promote: r.promote,
      promoted: r.promote.map((p) => p.brandName),
      needsDomain: r.needsDomain,
      candidatesExamined: PROD_REDDIT.length,
      scamExamined: PROD_SCAM.length,
      upserted: r.allFresh.length,
      upsertAttempted: r.allFresh.length,
      degraded: [],
      compoundUnresolved: 0,
      compoundUnresolvedSample: [],
      hasAlias: (raw) => Boolean(PROD_ALIASES[brandNormalize(raw) ?? ""]),
    });
    console.log("\n--- digest as it will be sent ---\n" + msg + "\n---\n");

    // The one thing that must be true of EVERY message, whatever the window
    // happens to contain: it proves the run actually looked.
    expect(msg).toContain("Examined");
    expect(msg).toContain("Review queue:");
  });
});

describe("PROD REPLAY — auto-promotion, if the flag were ON", () => {
  const r = replay({ autoPromote: true });

  it("promotes NOTHING on today's real data — and that is correct", () => {
    // Measured, not assumed. Nothing in this window has both a domain in
    // known_brands and enough evidence, so an operator with
    // FF_BRAND_AUTO_PROMOTE ON sees zero unattended writes to the live matcher.
    expect(r.promote).toHaveLength(0);
  });

  it("asks for a domain on the unknown brand ONLY, not on NAB", () => {
    // The digest line the operator actually reads. Before the gate fix this
    // window produced TWO entries under "Ready to promote — need a confirmed
    // domain": the Cancer Relief Fund and NAB, a brand already monitored whose
    // domain we have held in known_brands since 2026-06-15. One of those is a
    // real request; the other was the leak.
    expect(r.needsDomain.map((m) => m.brandNormalized)).toEqual([
      "schoolaustraliacancerrelieffund",
    ]);
  });

  it("suppresses the domain request once an operator marks it not_a_brand", () => {
    // The Cancer Relief Fund returns zero matches against acnc_charities — a
    // name the scammer invented. v291 gives the operator a word for that, and
    // planPromotions now reads it, so the request stops rather than repeating
    // every Monday for a brand that will never have a legitimate domain.
    const triaged = planPromotions(
      r.allFresh,
      new Map(),
      { schoolaustraliacancerrelieffund: "not_a_brand" },
    );
    expect(triaged.needsDomain).toHaveLength(0);
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
