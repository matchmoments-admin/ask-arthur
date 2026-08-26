import { describe, expect, it } from "vitest";
import {
  aggregateBrandMentions,
  buildDigestMessage,
  buildWatchedKeySet,
  hasAuEvidence,
  meetsPromotionBar,
  mergeCandidateSources,
  partitionForDigest,
  planPromotions,
  CANDIDATE_DENYLIST,
  type DigestInput,
  type MergedCandidate,
} from "@/app/api/inngest/functions/reddit-brands-discover";
import { brandNormalize } from "@askarthur/shopfront-glue";

describe("aggregateBrandMentions", () => {
  it("counts one mention per distinct normalized brand per post", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["CommBank", "ANZ"] },
      { brands_impersonated: ["commbank", "Telstra"] }, // commbank normalizes same as CommBank
      { brands_impersonated: null },
    ]);
    expect(agg.get("commbank")?.mentionCount).toBe(2);
    expect(agg.get("anz")?.mentionCount).toBe(1);
    expect(agg.get("telstra")?.mentionCount).toBe(1);
  });

  it("dedupes a brand listed twice in the same post", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Australia Post", "Australia Post", "auspost"] },
    ]);
    // "Australia Post" (x2) and "auspost" normalize differently, but the two
    // "Australia Post" entries in one post count once.
    expect(agg.get("australiapost")?.mentionCount).toBe(1);
    expect(agg.get("auspost")?.mentionCount).toBe(1);
  });

  it("keeps a representative raw string and ignores empty/symbol-only entries", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["  NAB  ", "!!!", ""] },
    ]);
    expect(agg.get("nab")?.rawBrand).toBe("NAB");
    expect(agg.size).toBe(1); // "!!!" and "" normalize to null → skipped
  });
});

describe("aggregateBrandMentions — AU attribution (v254)", () => {
  it("counts the AU-hinted subset alongside the total", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Telstra"], country_hints: ["AU"] },
      { brands_impersonated: ["Telstra"], country_hints: ["US"] },
      { brands_impersonated: ["Telstra"], country_hints: ["AU", "NZ"] },
    ]);
    expect(agg.get("telstra")).toMatchObject({ mentionCount: 3, auCount: 2 });
  });

  it("treats a missing or empty country_hints as no AU evidence, not as AU", () => {
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Xfinity"] },
      { brands_impersonated: ["Xfinity"], country_hints: null },
      { brands_impersonated: ["Xfinity"], country_hints: [] },
    ]);
    expect(agg.get("xfinity")).toMatchObject({ mentionCount: 3, auCount: 0 });
  });

  it("never lets the AU count exceed the total", () => {
    const agg = aggregateBrandMentions([
      // Same brand twice in one post, AU-hinted: one mention, one AU mention.
      { brands_impersonated: ["Optus", "optus"], country_hints: ["AU"] },
    ]);
    const optus = agg.get("optus")!;
    expect(optus.mentionCount).toBe(1);
    expect(optus.auCount).toBeLessThanOrEqual(optus.mentionCount);
  });

  it("attributes AU per-post, not per-brand-list", () => {
    // One AU post naming two brands gives BOTH brands one AU mention.
    const agg = aggregateBrandMentions([
      { brands_impersonated: ["Gumtree", "PayPal"], country_hints: ["AU"] },
    ]);
    expect(agg.get("gumtree")?.auCount).toBe(1);
    expect(agg.get("paypal")?.auCount).toBe(1);
  });
});

describe("buildWatchedKeySet", () => {
  it("includes canonical brand names AND aliases, normalized", () => {
    const set = buildWatchedKeySet([
      { brand: "Commonwealth Bank", aliases: ["CommBank", "CBA"] },
      { brand: "Australia Post" },
    ]);
    expect(set.has("commonwealthbank")).toBe(true);
    expect(set.has("commbank")).toBe(true);
    expect(set.has("cba")).toBe(true);
    expect(set.has("australiapost")).toBe(true);
    expect(set.has("anz")).toBe(false);
  });
});

describe("mergeCandidateSources (multi-source watchlist_candidates, Phase 1)", () => {
  const agg = (
    brandNormalized: string,
    rawBrand: string,
    mentionCount: number,
    auCount = 0,
  ) => ({ brandNormalized, rawBrand, mentionCount, auCount });

  it("sums counts for a brand seen in BOTH sources (scam never clobbers reddit)", () => {
    const merged = mergeCandidateSources(
      [agg("telstra", "Telstra", 4, 1)],
      [agg("telstra", "telstra", 3, 3)],
    );
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.reddit).toBe(4);
    expect(m.scam).toBe(3);
    expect(m.total).toBe(7);
    // AU counts sum across sources too — 1 AU-hinted Reddit post plus 3
    // AU-native reports.
    expect(m.au).toBe(4);
    // Reddit's raw string is kept as the representative.
    expect(m.rawBrand).toBe("Telstra");
  });

  it("keeps reddit-only and scam-only brands with the other source at 0", () => {
    const merged = mergeCandidateSources(
      [agg("hinge", "Hinge", 3)],
      [agg("depop", "Depop", 5, 5)],
    );
    const byKey = Object.fromEntries(merged.map((m) => [m.brandNormalized, m]));
    expect(byKey.hinge).toMatchObject({ reddit: 3, scam: 0, total: 3, au: 0 });
    expect(byKey.depop).toMatchObject({ reddit: 0, scam: 5, total: 5, au: 5 });
  });

  it("returns an empty list when neither source has candidates", () => {
    expect(mergeCandidateSources([], [])).toEqual([]);
  });

  it("passes scam candidates through unchanged when the reddit list is empty", () => {
    const merged = mergeCandidateSources([], [agg("depop", "Depop", 5, 5)]);
    expect(merged).toEqual([
      {
        brandNormalized: "depop",
        rawBrand: "Depop",
        reddit: 0,
        scam: 5,
        total: 5,
        au: 5,
      },
    ]);
  });
});

describe("hasAuEvidence — what reaches the actionable digest", () => {
  const cand = (rawBrand: string, total: number, au: number) => ({
    brandNormalized: brandNormalize(rawBrand)!,
    rawBrand,
    reddit: total,
    scam: 0,
    total,
    au,
  });

  it("silences the 2026-07-26 digest's US-only proposals", () => {
    // The five brands the digest actually asked a human to consider adding to
    // an AUSTRALIAN watchlist, each at exactly the ≥3 mention floor with zero
    // AU-hinted posts behind them.
    for (const brand of ["Xfinity", "NextDoor", "Chime", "American Express"]) {
      expect(hasAuEvidence(cand(brand, 3, 0))).toBe(false);
    }
  });

  it("admits a brand with even a single AU-attributable mention", () => {
    // Measured ceiling for AU evidence in a 30d window is 2 posts, so the bar
    // has to be 1 — anything higher is a permanent zero.
    expect(hasAuEvidence(cand("Capital One", 3, 1))).toBe(true);
    expect(hasAuEvidence(cand("Vinted", 4, 1))).toBe(true);
  });

  it("does not admit a high-volume global brand on volume alone", () => {
    // 28 mentions is a fact about r/Scams traffic, not about Australia.
    expect(hasAuEvidence(cand("Walmart", 17, 0))).toBe(false);
  });

  it("admits an AU-native reported brand with low global volume", () => {
    // The whole point of the scam_reports source: 2 Australian users beats
    // 28 Americans for deciding what an AU watchlist should monitor.
    const reported = { ...cand("Australia Post", 2, 2), reddit: 0, scam: 2 };
    expect(hasAuEvidence(reported)).toBe(true);
  });
});

describe("CANDIDATE_DENYLIST", () => {
  it("still denies platform names the classifier mis-tags as impersonated", () => {
    for (const noise of [
      "Reddit",
      "Discord",
      "LinkedIn",
      "Facebook Marketplace",
      "Meta",
      "TikTok",
    ]) {
      expect(CANDIDATE_DENYLIST.has(brandNormalize(noise))).toBe(true);
    }
  });

  it("matches the label the classifier emits, not the one a human would write", () => {
    // "X (Twitter)" normalises to "xtwitter", which neither the "X" entry
    // ("x") nor the "Twitter" entry ("twitter") covers. It sat pending in the
    // queue for a month because of that gap.
    expect(brandNormalize("X (Twitter)")).toBe("xtwitter");
    expect(CANDIDATE_DENYLIST.has(brandNormalize("X (Twitter)"))).toBe(true);
  });

  it("no longer hand-maintains a US-brand blocklist", () => {
    // These were denylisted by hand until v254. They are now handled by AU
    // evidence instead — the list was a worse version of a column we already
    // populate, and it was losing: Walmart, Verizon, USPS, Lowe's, Costco,
    // Xfinity, Chime and Capital One all sailed past it into the digest.
    for (const usBrand of [
      "Cash App",
      "Venmo",
      "Zelle",
      "Wells Fargo",
      "Bank of America",
      "Chase",
      "Robinhood",
      "MrBeast",
    ]) {
      expect(CANDIDATE_DENYLIST.has(brandNormalize(usBrand))).toBe(false);
    }
  });

  it("does not denylist legitimate AU brands", () => {
    for (const keep of ["Australia Post", "CommBank", "Telstra", "NAB"]) {
      expect(CANDIDATE_DENYLIST.has(brandNormalize(keep))).toBe(false);
    }
  });
});

describe("meetsPromotionBar — what may be promoted unattended", () => {
  const cand = (over: Partial<MergedCandidate>): MergedCandidate => ({
    brandNormalized: "x",
    rawBrand: "X",
    reddit: 0,
    scam: 0,
    total: 0,
    au: 0,
    ...over,
  });

  it("promotes on two AU-native reports — no geographic inference involved", () => {
    // Two Australians independently told Arthur this brand was impersonated.
    expect(meetsPromotionBar(cand({ scam: 2, au: 2, total: 2 }))).toBe(true);
  });

  it("promotes on two AU-hinted Reddit posts", () => {
    expect(meetsPromotionBar(cand({ reddit: 9, au: 2, total: 9 }))).toBe(true);
  });

  it("does NOT promote on a single AU mention", () => {
    // One AU hint is enough to SHOW a human (evidence is scarce). It is not
    // enough to act unattended, because the hint is inferred, not stated.
    expect(meetsPromotionBar(cand({ reddit: 3, au: 1, total: 3 }))).toBe(false);
  });

  it("does NOT promote on global volume alone, however large", () => {
    expect(meetsPromotionBar(cand({ reddit: 500, au: 0, total: 500 }))).toBe(false);
  });
});

describe("planPromotions — the domain is never guessed", () => {
  const cand = (
    key: string,
    raw: string,
    over: Partial<MergedCandidate> = {},
  ): MergedCandidate => ({
    brandNormalized: key,
    rawBrand: raw,
    reddit: 0,
    scam: 0,
    total: 0,
    au: 0,
    ...over,
  });

  const trusted = new Map([
    ["gumtree", { domain: "gumtree.com.au", source: "known_brands" }],
  ]);

  it("promotes only when the evidence bar AND a trusted domain are both met", () => {
    const r = planPromotions(
      [cand("gumtree", "Gumtree", { scam: 2, au: 2, total: 2 })],
      trusted,
    );
    expect(r.promote).toEqual([
      {
        brandNormalized: "gumtree",
        brandName: "Gumtree",
        domains: ["gumtree.com.au"],
        domainSource: "known_brands",
        au: 2,
        scam: 2,
        total: 2,
      },
    ]);
    expect(r.needsDomain).toEqual([]);
  });

  it("refuses to promote a qualifying brand with no trusted domain", () => {
    // The critical safety property. Guessing "<brand>.com.au" would be easy
    // and actively harmful: legitimate_domains is the matcher's EXCLUSION
    // list, so recording a squatter-held domain as legitimate is exactly how
    // you stop reporting the clone you were trying to catch.
    const c = cand("newbrand", "New Brand", { scam: 3, au: 3, total: 3 });
    const r = planPromotions([c], trusted);
    expect(r.promote).toEqual([]);
    expect(r.needsDomain).toEqual([c]);
  });

  it("ignores candidates below the bar even when a domain is known", () => {
    const r = planPromotions(
      [cand("gumtree", "Gumtree", { reddit: 50, au: 1, total: 50 })],
      trusted,
    );
    expect(r.promote).toEqual([]);
    expect(r.needsDomain).toEqual([]); // below the bar → not "ready", just not eligible
  });

  it("treats a blank domain string as no domain", () => {
    const r = planPromotions(
      [cand("blankco", "Blank Co", { scam: 2, total: 2, au: 2 })],
      new Map([["blankco", { domain: "", source: "known_brands" }]]),
    );
    expect(r.promote).toEqual([]);
    expect(r.needsDomain).toHaveLength(1);
  });

  it("returns nothing for an empty candidate list", () => {
    expect(planPromotions([], trusted)).toEqual({ promote: [], needsDomain: [] });
  });

  // REGRESSION (2026-08-27) — before this, planPromotions never saw `status`.
  // NAB leaked past the already-watched gate, cleared the bar on two reports,
  // had no known_brands domain under its leaked key, and so appeared under
  // "Ready to promote — need a confirmed domain" EVERY Monday. Nothing the
  // operator clicked could stop it: dismissing changed a column this function
  // did not read. The only exit was to promote it, which would have created a
  // duplicate NAB on the live matcher.
  it("stops re-asking for a domain on a brand the operator ruled out", () => {
    const c = cand("nabnationalaustraliabank", "NAB (National Australia Bank)", {
      scam: 2,
      au: 2,
      total: 2,
    });
    expect(planPromotions([c], trusted).needsDomain).toEqual([c]);
    for (const status of ["dismissed", "not_a_brand"]) {
      expect(
        planPromotions([c], trusted, { nabnationalaustraliabank: status })
          .needsDomain,
      ).toEqual([]);
    }
  });

  it("keeps asking after a REVIEWED decision — that is not a refusal", () => {
    // 'reviewed' means "worth monitoring, not yet promoted". Suppressing the
    // domain request there would bury the exact brands we most want promoted.
    const c = cand("newbrand", "New Brand", { scam: 2, au: 2, total: 2 });
    expect(
      planPromotions([c], trusted, { newbrand: "reviewed" }).needsDomain,
    ).toEqual([c]);
  });

  it("still AUTO-PROMOTES a dismissed brand — the asymmetry is deliberate", () => {
    // New evidence may reverse an old triage call, and that override is
    // announced rather than silent (see summary.promotionOverrides). Only the
    // "please type a domain" nag is suppressed, because that is a request the
    // operator has already declined.
    const r = planPromotions(
      [cand("gumtree", "Gumtree", { scam: 2, au: 2, total: 2 })],
      trusted,
      { gumtree: "dismissed" },
    );
    expect(r.promote).toHaveLength(1);
  });
});

describe("per-source thresholds — the promotion bar must be reachable", () => {
  const cand = (over: Partial<MergedCandidate>): MergedCandidate => ({
    brandNormalized: "x",
    rawBrand: "X",
    reddit: 0,
    scam: 0,
    total: 0,
    au: 0,
    ...over,
  });

  it("clears the bar on exactly two reports — the case a shared threshold made unreachable", () => {
    // Both sources used to be aggregated at >= 3, so a brand with exactly two
    // reports never entered the candidate table and this branch was dead code:
    // the bar was documented as 2 and behaved as 3. The scam source now
    // aggregates at >= 2, matching what meetsPromotionBar actually tests.
    expect(meetsPromotionBar(cand({ scam: 2, au: 2, total: 2 }))).toBe(true);
  });

  it("still refuses a single report", () => {
    expect(meetsPromotionBar(cand({ scam: 1, au: 1, total: 1 }))).toBe(false);
  });

  it("keeps the Reddit bar strictly higher than the reported-scam bar", () => {
    // Two AU-hinted Reddit posts qualify, but only because the brand also
    // cleared the Reddit source's own >= 3 total-mention floor. Two Reddit
    // mentions in total never reach the candidate table at all.
    expect(meetsPromotionBar(cand({ reddit: 3, au: 2, total: 3 }))).toBe(true);
    expect(meetsPromotionBar(cand({ reddit: 2, au: 1, total: 2 }))).toBe(false);
  });
});

describe("partitionForDigest — a brand can't be both unwatched and just-promoted", () => {
  const cand = (
    key: string,
    raw: string,
    over: Partial<MergedCandidate> = {},
  ): MergedCandidate => ({
    brandNormalized: key,
    rawBrand: raw,
    reddit: 0,
    scam: 0,
    total: 0,
    au: 0,
    ...over,
  });

  const surfaced = [
    cand("gumtree", "Gumtree", { scam: 2, au: 2, total: 2 }),
    cand("vinted", "Vinted", { reddit: 4, au: 1, total: 4 }),
    cand("walmart", "Walmart", { reddit: 17, au: 0, total: 17 }),
  ];

  it("drops auto-promoted brands from the unwatched lists", () => {
    // newlySurfaced is computed BEFORE promotion runs, so without the filter
    // Gumtree would be reported as "not yet on the clone-watch list" in the
    // same message that reports it was just added to the watchlist.
    const r = partitionForDigest(surfaced, new Set(["gumtree"]));
    expect(r.auEvidenced.map((m) => m.rawBrand)).toEqual(["Vinted"]);
    expect(r.globalOnly.map((m) => m.rawBrand)).toEqual(["Walmart"]);
  });

  it("keeps everything when nothing was promoted", () => {
    const r = partitionForDigest(surfaced, new Set());
    expect(r.auEvidenced.map((m) => m.rawBrand)).toEqual(["Gumtree", "Vinted"]);
    expect(r.globalOnly.map((m) => m.rawBrand)).toEqual(["Walmart"]);
  });

  it("splits on AU evidence, not on volume", () => {
    const r = partitionForDigest(surfaced, new Set());
    // Walmart has the largest total by far and still belongs in global-only.
    expect(r.globalOnly.map((m) => m.rawBrand)).toEqual(["Walmart"]);
    expect(r.auEvidenced.every((m) => m.au > 0)).toBe(true);
  });

  it("ranks AU-evidenced by AU count, falling back to total", () => {
    const r = partitionForDigest(
      [
        cand("a", "A", { au: 1, total: 99 }),
        cand("b", "B", { au: 3, total: 3 }),
        cand("c", "C", { au: 1, total: 5 }),
      ],
      new Set(),
    );
    expect(r.auEvidenced.map((m) => m.rawBrand)).toEqual(["B", "A", "C"]);
  });

  it("matches on the canonical key, not the display label", () => {
    // Two raw spellings share one canonical key; promoting via the key must
    // suppress whichever label the digest happened to pick.
    const r = partitionForDigest(
      [cand("gumtree", "gumtree.com.au", { scam: 2, au: 2, total: 2 })],
      new Set(["gumtree"]),
    );
    expect(r.auEvidenced).toEqual([]);
    expect(r.globalOnly).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [...surfaced];
    const before = JSON.stringify(input);
    partitionForDigest(input, new Set(["gumtree"]));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("buildDigestMessage — the digest cannot lie about the run", () => {
  const merged = (over: Partial<MergedCandidate> = {}): MergedCandidate => ({
    brandNormalized: "acme",
    rawBrand: "Acme",
    reddit: 3,
    scam: 0,
    total: 3,
    au: 0,
    ...over,
  });

  const input = (over: Partial<DigestInput> = {}): DigestInput => ({
    auEvidenced: [],
    globalOnly: [],
    promote: [],
    promoted: [],
    needsDomain: [],
    candidatesExamined: 45,
    scamExamined: 1,
    upserted: 12,
    upsertAttempted: 12,
    degraded: [],
    unresolvedLabels: 0,
    unresolvedSample: [],
    hasAlias: () => false,
    ...over,
  });

  // ---- Invariant 1: proof of life is UNCONDITIONAL -------------------------

  it("prints the Examined heartbeat when every list is empty", () => {
    expect(buildDigestMessage(input())).toContain("Examined <b>45</b> Reddit brand(s)");
  });

  it("STILL prints the heartbeat when a global-only brand is present", () => {
    // The regression that motivated the extraction. The old code gated the
    // heartbeat on all four lists being empty, and prod had exactly one
    // net-new global-only brand ("Google Play" x3), so the next real run would
    // have lost its proof of life entirely.
    const msg = buildDigestMessage(
      input({ globalOnly: [merged({ rawBrand: "Google Play", total: 3 })] }),
    );
    expect(msg).toContain("Examined <b>45</b> Reddit brand(s)");
    expect(msg).toContain("Google Play ×3");
  });

  it("still prints the heartbeat when there is a full actionable list", () => {
    const msg = buildDigestMessage(
      input({ auEvidenced: [merged({ rawBrand: "Acme", au: 2, total: 4 })] }),
    );
    expect(msg).toContain("Examined <b>45</b> Reddit brand(s)");
    expect(msg).toContain("<b>AU 2</b>/4");
  });

  it("reports recorded N/M so a partial write is visible", () => {
    expect(buildDigestMessage(input({ upserted: 3, upsertAttempted: 46 }))).toContain(
      "recorded 3/46",
    );
  });

  // ---- Invariant 2: a degraded run never reads as a quiet one --------------

  it("claims the healthy steady state only when nothing failed", () => {
    expect(buildDigestMessage(input())).toContain("healthy steady state");
  });

  it("withholds the steady-state claim when a step failed", () => {
    // The worst pre-existing behaviour: an errored aggregate returned [], so
    // the digest read "Examined 0 Reddit brand(s)... This is the healthy steady
    // state" — a dead RPC asserting health.
    const msg = buildDigestMessage(
      input({ candidatesExamined: 0, degraded: ["reddit_aggregate_failed"] }),
    );
    expect(msg).not.toContain("healthy steady state");
    expect(msg).toContain("DEGRADED THIS RUN");
    expect(msg).toContain("reddit_aggregate_failed");
  });

  it("leads with the degradation warning, before the header", () => {
    // Position matters: an operator skimming a phone notification sees the
    // first lines only.
    const msg = buildDigestMessage(input({ degraded: ["upserts_partial"] }));
    const lines = msg.split("\n");
    expect(lines[0]).toContain("Brands discover");
    expect(lines[1]).toContain("DEGRADED THIS RUN");
    expect(msg.indexOf("DEGRADED")).toBeLessThan(msg.indexOf("No new AU-evidenced"));
  });

  it("does not repeat one root cause six times", () => {
    // A missing service client fails all six fallible steps. The handler
    // collects reasons in a Set for exactly this reason: "no_db_client,
    // no_db_client, no_db_client, ..." in a Telegram message buries the signal
    // the line exists to carry. This pins the rendering side of that contract.
    const msg = buildDigestMessage(input({ degraded: ["no_db_client"] }));
    expect(msg.match(/no_db_client/g)).toHaveLength(1);
  });

  it("names every degradation reason, not just the first", () => {
    const msg = buildDigestMessage(
      input({ degraded: ["scam_aggregate_failed", "upserts_partial"] }),
    );
    expect(msg).toContain("scam_aggregate_failed");
    expect(msg).toContain("upserts_partial");
  });

  // ---- Existing sections still render -------------------------------------

  it("reports auto-promotions with their domain source", () => {
    const msg = buildDigestMessage(
      input({
        promote: [
          {
            brandNormalized: "acme",
            brandName: "Acme",
            domains: ["acme.com.au"],
            domainSource: "known_brands",
            au: 2,
            scam: 2,
            total: 4,
          },
        ],
        promoted: ["Acme"],
      }),
    );
    expect(msg).toContain("Auto-promoted to the watchlist (1)");
    expect(msg).toContain("acme.com.au");
    expect(msg).toContain("domain from known_brands");
  });

  it("lists brands that cleared the bar but had no trustworthy domain", () => {
    const msg = buildDigestMessage(
      input({ needsDomain: [merged({ rawBrand: "Acme", scam: 2, au: 2, total: 2 })] }),
    );
    expect(msg).toContain("need a confirmed domain (1)");
    expect(msg).toContain("• Acme (AU 2, reported 2)");
  });

  it("tags known aliases in the actionable list", () => {
    const msg = buildDigestMessage(
      input({ auEvidenced: [merged({ au: 1 })], hasAlias: () => true }),
    );
    expect(msg).toContain("(known alias)");
  });
  it("escapes a brand label so one ampersand cannot kill the whole digest", () => {
    // sendAdminTelegramMessage posts with parse_mode=HTML. Telegram 400s on
    // malformed markup, and a 400 means the digest never arrives at all —
    // indistinguishable from a dead cron, which is the failure this file's
    // heartbeat exists to prevent.
    //
    // Not hypothetical: AT&T has been sitting `pending` in
    // reddit_watchlist_candidates since 2026-08-24 with 5 mentions. It has not
    // broken a digest only because it stopped being net-new before it was ever
    // rendered.
    const msg = buildDigestMessage(
      input({
        auEvidenced: [merged({ brandNormalized: "att", rawBrand: "AT&T", au: 2, scam: 2 })],
      }),
    );
    expect(msg).toContain("AT&amp;T");
    expect(msg).not.toMatch(/AT&T/);
  });

  it("reports labels the canonical layer could not identify", () => {
    // The accuracy half of proof-of-life. The heartbeat says the run LOOKED;
    // this says whether it UNDERSTOOD. Every bug in this file — v260, v261, the
    // NAB leak — was a label silently unresolved for weeks.
    const msg = buildDigestMessage(
      input({ unresolvedLabels: 7, unresolvedSample: ["NAB (National Australia Bank)"] }),
    );
    expect(msg).toContain("<b>7</b> label(s) matched no known brand");
    expect(msg).toContain("NAB (National Australia Bank)");
    expect(msg).toContain(", …"); // 7 > 1 sampled
  });

  it("says nothing about unresolved labels when there are none", () => {
    expect(buildDigestMessage(input({}))).not.toContain("matched no known brand");
  });
});

describe("buildDigestMessage — an unattended promotion cannot silently override a human", () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    brandNormalized: "acme",
    brandName: "Acme",
    domains: ["acme.com.au"],
    domainSource: "known_brands",
    au: 2,
    scam: 2,
    total: 4,
    ...over,
  });

  const base = {
    auEvidenced: [],
    globalOnly: [],
    needsDomain: [],
    candidatesExamined: 45,
    scamExamined: 1,
    upserted: 12,
    upsertAttempted: 12,
    degraded: [],
    unresolvedLabels: 0,
    unresolvedSample: [],
    hasAlias: () => false,
  };

  it("flags a promotion that reverses an earlier dismissal", () => {
    // The scenario: an operator dismissed Acme as irrelevant. Weeks later two
    // Australians report it, clearing the promotion bar, and the cron adds it
    // to the LIVE matcher unattended. That is defensible — new evidence — but
    // the operator must not discover it by noticing it.
    const msg = buildDigestMessage({
      ...base,
      promote: [plan()],
      promoted: ["Acme"],
      priorTriage: { acme: "dismissed" },
    } as DigestInput);
    expect(msg).toContain("OVERRIDES your earlier 'dismissed'");
    expect(msg).toContain("reversed a decision you had already made");
  });

  it("flags a reversal of 'reviewed' too, not just 'dismissed'", () => {
    const msg = buildDigestMessage({
      ...base,
      promote: [plan()],
      promoted: ["Acme"],
      priorTriage: { acme: "reviewed" },
    } as DigestInput);
    expect(msg).toContain("OVERRIDES your earlier 'reviewed'");
  });

  it("says nothing about overrides when the brand was never triaged", () => {
    // No false alarms: a brand nobody has ruled on is just a normal promotion.
    const msg = buildDigestMessage({
      ...base,
      promote: [plan()],
      promoted: ["Acme"],
      priorTriage: {},
    } as DigestInput);
    expect(msg).not.toContain("OVERRIDES");
    expect(msg).toContain("Undo any of these from the review queue.");
  });

  it("keys the override on the canonical key, not the display label", () => {
    // Two raw spellings share one canonical key; the triage record is keyed on
    // the canonical, so matching on brandName would miss the override.
    const msg = buildDigestMessage({
      ...base,
      promote: [plan({ brandNormalized: "acme", brandName: "ACME Corp" })],
      promoted: ["ACME Corp"],
      priorTriage: { acme: "dismissed" },
    } as DigestInput);
    expect(msg).toContain("OVERRIDES");
  });

  it("counts only the overriding promotions, not every promotion", () => {
    const msg = buildDigestMessage({
      ...base,
      promote: [
        plan(),
        plan({ brandNormalized: "beta", brandName: "Beta" }),
        plan({ brandNormalized: "gamma", brandName: "Gamma" }),
      ],
      promoted: ["Acme", "Beta", "Gamma"],
      priorTriage: { acme: "dismissed" },
    } as DigestInput);
    expect(msg).toContain("Auto-promoted to the watchlist (3)");
    expect(msg).toContain("1 of these reversed a decision");
  });

});
