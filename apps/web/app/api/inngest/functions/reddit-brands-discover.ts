import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  brandNormalize,
  buildBrandResolver,
  buildWatchedKeySet,
  type BrandAliasRecord,
} from "@askarthur/shopfront-glue";
import { getActiveWatchlist } from "@askarthur/scam-engine/active-watchlist";
import { createServiceClient } from "@askarthur/supabase/server";
import { getLogger } from "@askarthur/utils/axiom-logger";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { loadAliasRecord } from "@/lib/brand-aliases";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

/**
 * Reddit Brands Discover — feed the clone-watch watchlist-curation loop.
 *
 * The clone-watch monitored set is a COMPILE-TIME TS array
 * (packages/shopfront-glue/src/au-brand-watchlist.ts); it only grows by a human
 * hand-editing the array + re-seeding brand_aliases. reddit_post_intel
 * .brands_impersonated[] is a live feed of which brands scammers impersonate
 * now. This weekly cron aggregates those mentions over a 30-day window,
 * resolves them through the v174 alias layer, drops the brands already on the
 * watchlist (by canonical key OR alias), and writes the unwatched remainder to
 * reddit_watchlist_candidates + a Telegram digest for a human to review.
 *
 * It NEVER auto-promotes — promotion to the watchlist is still a manual PR
 * (compile-time array + an alias re-seed migration). This just surfaces the
 * candidates so the curation isn't blind.
 *
 * AU RELEVANCE (v254)
 * -------------------
 * The corpus this reads (r/Scams + r/phishing) is not Australian. Measured
 * over the 30 days to 2026-07-27, country_hints across ingested posts split
 * US 427 / GB 55 / CA 52 / AU 30 / IN 15 — about 93% non-AU. Ranking
 * candidates by raw mention count therefore ranks them by "how American is
 * this brand", which is how the 2026-07-26 digest came to propose Xfinity,
 * NextDoor, Chime and Capital One for an Australian clone-watch list, each at
 * exactly the ≥3 floor.
 *
 * So every candidate now carries an AU-attributable count alongside its total,
 * and the digest's actionable list is AU-evidenced candidates only. Two things
 * this deliberately does NOT do:
 *
 *   - It does not FILTER on AU. The AU-hinted subset tops out at 2 posts for
 *     any single brand, so a ≥3 AU gate returns zero candidates forever — the
 *     feature would go silent while still reporting ok:true. Everything is
 *     still recorded; AU evidence decides what gets announced, not what gets
 *     stored.
 *   - It does not treat "no AU hint" as "not Australian". country_hints is
 *     sparse. Global-only candidates get a one-line summary rather than
 *     silent suppression.
 *
 * No paid API (pure SQL read + in-process brandNormalize), so no cost brake —
 * runtime cost is effectively $0. Weekly cadence; pulls a bounded window.
 *
 * OBSERVABILITY — why a WEEKLY cron needs more than withAxiomLogging
 * -----------------------------------------------------------------
 * The HOF emits `fn.start` / `fn.complete` at Axiom INFO, and prod samples INFO
 * to 10% (AXIOM_SAMPLE_PCT unset -> 10). For a function that runs 52 times a
 * year that is ~5 observable runs — so "did Monday's run happen?" was not
 * answerable from Axiom at all. Worse, the per-run numbers went only to
 * `logger.info`, which is console.log with NO Axiom transport (see
 * packages/utils/src/logger.ts), so they never arrived at any sample rate. The
 * only always-ship signal was `fn.error`.
 *
 * So this function additionally emits ONE `warn`-level Axiom event per run —
 * `reddit-brands-discover.summary` — carrying every count plus the degradation
 * list. WARN bypasses sampling, so every run lands; one event a week is nothing
 * against the 400 GB/mo budget. Same shape as competitor-intel-extract-cron.
 *
 * DEGRADATION MUST NOT READ AS HEALTH
 * -----------------------------------
 * Four steps here can fail and still return a well-formed empty result. Left
 * unreported, an errored `aggregate_reddit_brands_with_au` produced a digest
 * saying "Examined 0 Reddit brand(s)… Nothing new… This is the healthy steady
 * state" — a dead RPC asserting health, which is strictly worse than the silence
 * the heartbeat was added to fix. Each of the SIX fallible steps therefore
 * returns { rows, failed } and the handler collects the reasons. The digest
 * leads with a warning when any are present, and the "healthy steady state"
 * wording is printed ONLY when there are none.
 */

const WINDOW_DAYS = 30;
// Per-source recording thresholds. These are deliberately NOT one shared
// number: the two sources are not the same unit of evidence.
//
//   Reddit  — a mention in r/Scams or r/phishing. Third-party, global, and
//             ~93% non-AU (v254). Three of them is a weak-ish signal.
//   Reported — someone used an Australian scam-checker and named the brand
//             they were being impersonated by. First-party, AU-native, no
//             geographic inference. Two of those is a STRONGER signal than
//             three Reddit posts, and there will always be far fewer of them.
//
// Sharing one threshold at 3 also made meetsPromotionBar()'s `scam >= 2`
// branch DEAD CODE: a brand with exactly two reports never entered the
// candidate table, so the bar it was tested against could never be reached.
// The bar was documented as 2 and behaved as 3.
const REDDIT_MENTION_THRESHOLD = 3;
const SCAM_REPORT_THRESHOLD = 2;
// Cap how many candidates the Telegram digest lists (the table holds them all).
const DIGEST_CAP = 25;
// How many global-only (zero AU evidence) brands to name in the summary line.
const GLOBAL_ONLY_PREVIEW = 5;

// Platform names the upstream classifier mis-tags as "impersonated" when a scam
// merely happened ON that platform (Reddit/Discord/Marketplace…). This is a
// classifier-taxonomy problem, not a geography one, so it stays a hand-curated
// list. Matched on brandNormalize() (same normaliser the aggregator uses), so
// casing/spacing variants collapse to one key.
//
// The list USED to carry a second half — "US-only / non-AU brands" (Cash App,
// Venmo, Zelle, Wells Fargo, Bank of America, Chase, Robinhood, MrBeast). That
// half is gone: it was a hand-maintained proxy for a column we already
// populate, and it was losing. On 2026-07-27 it named 8 US brands while
// Walmart(15), Verizon(6), USPS(3), Lowe's(3), Costco(3), Xfinity, Chime and
// Capital One all sailed past it into the digest. Geographic relevance is now
// decided by reddit_post_intel.country_hints (see AU-evidence gating below),
// which is data rather than a list somebody has to remember to update.
const CANDIDATE_DENYLIST_RAW: readonly string[] = [
  "Reddit", "Discord", "LinkedIn", "Facebook", "Facebook Marketplace", "Meta",
  "Instagram", "TikTok", "Telegram", "WhatsApp", "Steam", "Shop", "X", "Twitter",
  "YouTube", "Snapchat",
  // "X (Twitter)" is how the classifier actually labels it, and it normalises
  // to "xtwitter" — which neither "X" ("x") nor "Twitter" ("twitter") matches.
  // It sat pending in the queue for a month because of that. A denylist entry
  // has to match the label the upstream classifier emits, not the label a
  // human would write.
  "X (Twitter)",
];
// Exported for testing. Holds brandNormalize() keys, not raw labels.
export const CANDIDATE_DENYLIST = new Set(
  CANDIDATE_DENYLIST_RAW.map((b) => brandNormalize(b)).filter(Boolean),
);

interface CandidateAgg {
  brandNormalized: string;
  rawBrand: string;
  mentionCount: number;
  /** Of `mentionCount`, how many carry Australian evidence. Always <=
   *  mentionCount. Zero is the common case and is meaningful, not missing. */
  auCount: number;
}

/** Aggregate brands_impersonated rows into per-canonical-key mention counts.
 *  Pure + unit-tested: one count per distinct normalized brand per POST (a post
 *  listing the same brand twice counts once), keeping a representative raw
 *  string. Exported for testing. */
export function aggregateBrandMentions(
  rows: Array<{ brands_impersonated: string[] | null; country_hints?: string[] | null }>,
): Map<string, CandidateAgg> {
  const agg = new Map<string, CandidateAgg>();
  for (const row of rows) {
    // A post is AU-attributable when the classifier tagged it with an AU
    // country hint. Absence is NOT evidence of non-AU — country_hints is
    // sparse — which is exactly why this counts up rather than filtering out.
    const isAu = (row.country_hints ?? []).includes("AU");
    const seenThisPost = new Set<string>();
    for (const raw of row.brands_impersonated ?? []) {
      const norm = brandNormalize(raw);
      if (!norm || seenThisPost.has(norm)) continue;
      seenThisPost.add(norm);
      const existing = agg.get(norm);
      if (existing) {
        existing.mentionCount += 1;
        if (isAu) existing.auCount += 1;
      } else {
        agg.set(norm, {
          brandNormalized: norm,
          rawBrand: raw.trim(),
          mentionCount: 1,
          auCount: isAu ? 1 : 0,
        });
      }
    }
  }
  return agg;
}

// buildWatchedKeySet moved to @askarthur/shopfront-glue so the "already
// watched?" predicate has exactly one implementation, and is re-exported here
// so existing importers (and tests) keep working.
export { buildWatchedKeySet };

/** One-row-per-canonical-brand view carrying per-source counts + the summed
 *  total (the digest shows the breakdown; the DB stores the total). */
export interface MergedCandidate {
  brandNormalized: string;
  rawBrand: string;
  reddit: number;
  scam: number;
  total: number;
  /** AU-attributable mentions summed across sources. The digest ranks and
   *  gates on this; `total` alone is a measure of r/Scams traffic, not of
   *  Australian exposure. */
  au: number;
}

/** Merge the Reddit + reported-scam fresh-candidate lists into one row per
 *  canonical brand. A brand seen in both keeps the Reddit raw string as its
 *  representative and sums the two counts. Pure + unit-tested — the TS mirror of
 *  what upsert_watchlist_candidate does per-source in the DB. Exported for
 *  testing. */
export function mergeCandidateSources(
  reddit: CandidateAgg[],
  scam: CandidateAgg[],
): MergedCandidate[] {
  const merged = new Map<string, MergedCandidate>();
  for (const c of reddit) {
    merged.set(c.brandNormalized, {
      brandNormalized: c.brandNormalized,
      rawBrand: c.rawBrand,
      reddit: c.mentionCount,
      scam: 0,
      total: c.mentionCount,
      au: c.auCount,
    });
  }
  for (const c of scam) {
    const ex = merged.get(c.brandNormalized);
    if (ex) {
      ex.scam = c.mentionCount;
      ex.total += c.mentionCount;
      ex.au += c.auCount;
    } else {
      merged.set(c.brandNormalized, {
        brandNormalized: c.brandNormalized,
        rawBrand: c.rawBrand,
        reddit: 0,
        scam: c.mentionCount,
        total: c.mentionCount,
        au: c.auCount,
      });
    }
  }
  return [...merged.values()];
}

/**
 * Does this candidate carry evidence that it matters in Australia?
 *
 * The clone-watch watchlist exists to catch lookalike domains aimed at
 * Australian consumers. Raw r/Scams volume is a measure of that subreddit's
 * traffic, not of Australian exposure — over the 30 days to 2026-07-27 the
 * corpus split US 427 / GB 55 / CA 52 / AU 30, so ranking by global mentions
 * is ranking by "how American is this brand".
 *
 * Deliberately a ONE-mention bar, not a proportional one. AU evidence is
 * scarce (the AU-hinted subset tops out at 2 posts for any single brand), so
 * anything stricter silences the feature entirely while leaving it looking
 * healthy. Exported for testing.
 */
export function hasAuEvidence(m: MergedCandidate): boolean {
  return m.au > 0;
}

/**
 * Does this candidate clear the bar for AUTOMATIC promotion?
 *
 * A much higher bar than `hasAuEvidence`, which only decides whether a human
 * is shown the brand. This decides whether the system adds a brand to the live
 * matcher with no human in the loop, so the two sources are weighted by how
 * much inference stands behind them:
 *
 *   - `scam >= 2` — two Australians independently told Arthur this brand was
 *     impersonated. Zero geographic inference: they are users of an AU
 *     consumer scam-checker. This is our own demand signal.
 *   - `au >= 2` — two Reddit posts the classifier tagged AU. One AU-hinted
 *     post is enough to show a human (evidence is scarce); it is not enough to
 *     act unattended, because the hint is inferred, not stated.
 *
 * Both are deliberately small absolute numbers. At current volume that means
 * auto-promotion fires rarely — which is the correct behaviour, not a defect
 * to tune away. It scales with Arthur's own traffic rather than with r/Scams
 * traffic. Exported for testing.
 */
export function meetsPromotionBar(m: MergedCandidate): boolean {
  return m.scam >= 2 || m.au >= 2;
}

/**
 * Split the net-new candidates into the two lists the digest reports, having
 * first removed anything already auto-promoted this run.
 *
 * The exclusion is the load-bearing part. `newlySurfaced` is computed BEFORE
 * promotion runs, so without it one message would list a brand under "not yet
 * on the clone-watch list" AND under "auto-promoted to the watchlist" — two
 * contradictory claims about the same brand. An operator only needs to see
 * that once to stop trusting the digest.
 *
 * Keyed on brandNormalized rather than the display label, because two raw
 * spellings can share a canonical key. Pure + unit-tested. Exported for
 * testing.
 */
export function partitionForDigest(
  newlySurfaced: readonly MergedCandidate[],
  promotedKeys: ReadonlySet<string>,
): { auEvidenced: MergedCandidate[]; globalOnly: MergedCandidate[] } {
  const stillUnwatched = newlySurfaced.filter(
    (m) => !promotedKeys.has(m.brandNormalized),
  );
  return {
    auEvidenced: stillUnwatched
      .filter(hasAuEvidence)
      .sort((a, b) => b.au - a.au || b.total - a.total),
    globalOnly: stillUnwatched
      .filter((m) => !hasAuEvidence(m))
      .sort((a, b) => b.total - a.total),
  };
}

/** A promotion the run is prepared to make: evidence bar cleared AND a
 *  trustworthy domain found. Both halves are required. */
export interface PromotionPlan {
  brandNormalized: string;
  brandName: string;
  domains: string[];
  /** Where the domain came from — recorded so a bad promotion is traceable to
   *  its source rather than to "the cron did it". */
  domainSource: string;
  au: number;
  scam: number;
  total: number;
}

/**
 * Pair candidates that clear the evidence bar with a domain from a TRUSTED
 * store, and report the ones we cannot promote and why.
 *
 * THE DOMAIN IS NEVER GUESSED. It would be easy to try `<brand>.com.au` and
 * accept whatever resolves — and actively harmful. legitimate_domains is the
 * matcher's EXCLUSION list, so a wrong entry does not cause a missed alert, it
 * creates a permanent blind spot: if a squatter holds `<brand>.com.au` and we
 * record it as legitimate, that is precisely the domain we stop reporting.
 * A brand with no trustworthy domain is therefore NOT auto-promoted; it is
 * surfaced as "ready, needs a domain" for a human to complete in one click.
 *
 * Pure + unit-tested. Exported for testing.
 */
export function planPromotions(
  candidates: readonly MergedCandidate[],
  domainsByKey: ReadonlyMap<string, { domain: string; source: string }>,
): { promote: PromotionPlan[]; needsDomain: MergedCandidate[] } {
  const promote: PromotionPlan[] = [];
  const needsDomain: MergedCandidate[] = [];
  for (const c of candidates) {
    if (!meetsPromotionBar(c)) continue;
    const known = domainsByKey.get(c.brandNormalized);
    if (!known?.domain) {
      needsDomain.push(c);
      continue;
    }
    promote.push({
      brandNormalized: c.brandNormalized,
      brandName: c.rawBrand,
      domains: [known.domain],
      domainSource: known.source,
      au: c.au,
      scam: c.scam,
      total: c.total,
    });
  }
  return { promote, needsDomain };
}

/** Everything the digest needs to describe a run. Counts rather than the raw
 *  step results, because the message is a report ABOUT the run, not a second
 *  computation over its inputs. */
export interface DigestInput {
  auEvidenced: readonly MergedCandidate[];
  globalOnly: readonly MergedCandidate[];
  promote: readonly PromotionPlan[];
  promoted: readonly string[];
  needsDomain: readonly MergedCandidate[];
  /** Reddit brands examined (pre-filter) — proof the run actually looked. */
  candidatesExamined: number;
  /** Reported-scam brands examined (pre-filter). */
  scamExamined: number;
  upserted: number;
  upsertAttempted: number;
  /** Non-empty means the counts above UNDERSTATE reality. */
  degraded: readonly string[];
  /** True when the brand has a known alias — renders a "(known alias)" tag. */
  hasAlias: (rawBrand: string) => boolean;
}

/**
 * Build the Telegram digest.
 *
 * Extracted as a pure function for the same reason `partitionForDigest` was in
 * #878: inside a `step.run` closure this logic is unreachable to tests, and it
 * is precisely where the reporting bugs have lived. Two invariants it now owes,
 * both of which were violated by the version this replaces:
 *
 *   1. THE HEARTBEAT IS UNCONDITIONAL. It used to print only when all four
 *      lists were empty, so a single global-only brand suppressed the numbers
 *      that answer "did it actually look?". Measured 2026-07-30, that brand
 *      existed ("Google Play" ×3), so the very next run would have lost its
 *      proof of life. Proof of life cannot be conditional on the absence of
 *      content — that is the same bug as the silence it was added to fix.
 *
 *   2. A DEGRADED RUN NEVER READS AS A QUIET ONE. The "healthy steady state"
 *      wording is withheld whenever any step failed, and the failure leads the
 *      message. Otherwise an errored aggregate produced "Examined 0 Reddit
 *      brand(s)… This is the healthy steady state" — a dead RPC asserting
 *      health, which is worse than saying nothing.
 *
 * Exported for testing.
 */
export function buildDigestMessage(d: DigestInput): string {
  const top = d.auEvidenced.slice(0, DIGEST_CAP);
  const lines = top.map((m) => {
    const parts: string[] = [];
    if (m.reddit > 0) parts.push(`Reddit ×${m.reddit}`);
    if (m.scam > 0) parts.push(`reported ×${m.scam}`);
    const aliasTag = d.hasAlias(m.rawBrand) ? " (known alias)" : "";
    // Always show the AU/global split so a 1-of-28 brand can't be mistaken for
    // a strong signal.
    return (
      `• <b>${m.rawBrand}</b> — ${parts.join(", ")} · ` +
      `<b>AU ${m.au}</b>/${m.total}${aliasTag}`
    );
  });
  const more =
    d.auEvidenced.length > DIGEST_CAP
      ? [`…and ${d.auEvidenced.length - DIGEST_CAP} more AU-evidenced.`]
      : [];

  const nothingActionable =
    d.auEvidenced.length === 0 &&
    d.globalOnly.length === 0 &&
    d.promoted.length === 0 &&
    d.needsDomain.length === 0;

  const header =
    d.auEvidenced.length > 0
      ? `<b>${d.auEvidenced.length}</b> new brand(s) impersonated WITH Australian evidence ` +
        `(last ${WINDOW_DAYS}d: ≥${REDDIT_MENTION_THRESHOLD} Reddit mentions or ` +
        `≥${SCAM_REPORT_THRESHOLD} reported to Arthur) — ` +
        `not yet on the clone-watch list:`
      : `No new AU-evidenced brands this week.`;

  const degradedLines =
    d.degraded.length > 0
      ? [
          `⚠️ <b>DEGRADED THIS RUN</b> — the counts below UNDERSTATE reality: ` +
            `${d.degraded.join(", ")}.`,
          `<i>Do not read this as a quiet week.</i>`,
        ]
      : [];

  const heartbeat = [
    `Examined <b>${d.candidatesExamined}</b> Reddit brand(s) over ${WINDOW_DAYS}d ` +
      `(≥${REDDIT_MENTION_THRESHOLD} mentions) and ` +
      `<b>${d.scamExamined}</b> reported-scam brand(s) ` +
      `(≥${SCAM_REPORT_THRESHOLD}); ` +
      `recorded ${d.upserted}/${d.upsertAttempted}.`,
    ...(nothingActionable && d.degraded.length === 0
      ? [
          `Nothing new: every candidate is already watched, already in the ` +
            `queue, or a platform name. <i>This is the healthy steady state.</i>`,
        ]
      : []),
  ];

  // One line, not N — the global tail is context, not a worklist.
  const globalLine =
    d.globalOnly.length > 0
      ? [
          ``,
          `<i>Plus ${d.globalOnly.length} new global-only candidate(s) with no AU ` +
            `evidence — recorded, not actioned: ` +
            d.globalOnly
              .slice(0, GLOBAL_ONLY_PREVIEW)
              .map((m) => `${m.rawBrand} ×${m.total}`)
              .join(", ") +
            (d.globalOnly.length > GLOBAL_ONLY_PREVIEW ? ", …" : "") +
            `</i>`,
        ]
      : [];

  // Auto-promotions are reported even though nobody asked for them: an
  // unattended write to the live matcher that shows up only in logs is how you
  // find out about it from a customer.
  const promotedLines =
    d.promoted.length > 0
      ? [
          ``,
          `<b>Auto-promoted to the watchlist (${d.promoted.length}):</b>`,
          ...d.promote
            .filter((p) => d.promoted.includes(p.brandName))
            .map(
              (p) =>
                `• <b>${p.brandName}</b> → ${p.domains.join(", ")} ` +
                `(AU ${p.au}, reported ${p.scam}; domain from ${p.domainSource})`,
            ),
          `<i>Undo any of these from the review queue.</i>`,
        ]
      : [];

  // The other half of the honest report: brands that DID clear the evidence bar
  // but had no trustworthy domain, so the system declined to guess. These are
  // one click from promotion, not dead ends.
  const needsDomainLines =
    d.needsDomain.length > 0
      ? [
          ``,
          `<b>Ready to promote — need a confirmed domain (${d.needsDomain.length}):</b>`,
          ...d.needsDomain
            .slice(0, DIGEST_CAP)
            .map((m) => `• ${m.rawBrand} (AU ${m.au}, reported ${m.scam})`),
        ]
      : [];

  return [
    `<b>Brands discover</b>`,
    ...degradedLines,
    header,
    ...heartbeat,
    ...lines,
    ...more,
    ...globalLine,
    ...promotedLines,
    ...needsDomainLines,
    ``,
    `Review queue: https://askarthur.au/admin/brand-candidates`,
  ].join("\n");
}

export const redditBrandsDiscover = inngest.createFunction(
  {
    id: "reddit-brands-discover",
    name: "Reddit Brands: watchlist candidate discovery",
    timeouts: { finish: "5m" },
    retries: 1,
    concurrency: { limit: 1 },
    // concurrency alone SERIALISES stacked manual fires, it does not cap them —
    // Inngest queues them and runs each in turn, so N fires still meant N
    // Telegram digests and N full re-upserts. The cron needs one run a week; the
    // allowance of two an hour exists so an operator can deliberately re-run
    // once (e.g. verifying a fix) without being able to storm the admin chat.
    rateLimit: { limit: 2, period: "1h" },
  },
  [
    { cron: "0 7 * * 1" }, // weekly, Monday 07:00 UTC
    { event: "reddit-brands/discover.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "reddit-brands-discover" }, async ({ step, runId }) => {
    if (!featureFlags.redditBrandsDiscover) {
      return { skipped: true, reason: "flag_off" };
    }

    // Every fallible step that can return a well-formed EMPTY result records
    // here. Non-empty means the run's numbers understate reality, so the digest
    // must not describe them as a steady state and the Axiom summary must be
    // findable by `degraded == true`.
    //
    // A Set, not an array: one root cause (a missing service client) fails
    // SIX steps, and "no_db_client, no_db_client, no_db_client, …" in a
    // Telegram message obscures the very thing the line exists to communicate.
    // Insertion order is preserved, so the first failure still reads first.
    const degradedSet = new Set<string>();
    const markDegraded = (reason: string | null | undefined) => {
      if (reason) degradedSet.add(reason);
    };

    // 1. Bulk-load the v174 alias layer once (read-side resolver — NOT a
    //    per-row RPC). Plain Record so it survives Inngest step serialisation.
    const aliasPairs = await step.run("load-brand-aliases", async () => {
      const sb = createServiceClient();
      if (!sb) return {} as BrandAliasRecord;
      return loadAliasRecord(sb, "reddit-brands-discover");
    });
    const resolveCanonical = buildBrandResolver(aliasPairs);

    // 2. Aggregate brand mentions over the window, with the AU-hinted subset
    //    counted separately (v254). Server-side so only aggregated rows ship
    //    rather than every brands_impersonated array in the window; the
    //    grouping key is public.brand_normalize(), the SQL twin of the
    //    brandNormalize() used everywhere on this side.
    const candidatesStep = await step.run("aggregate-mentions", async () => {
      const sb = createServiceClient();
      if (!sb) return { rows: [] as CandidateAgg[], failed: "no_db_client" };
      const since = new Date(
        Date.now() - WINDOW_DAYS * 24 * 3600 * 1000,
      ).toISOString();
      const { data, error } = await sb.rpc("aggregate_reddit_brands_with_au", {
        p_since: since,
        p_min_count: REDDIT_MENTION_THRESHOLD,
      });
      if (error) {
        logger.error("reddit-brands-discover: mention query failed", {
          error: error.message,
        });
        return { rows: [] as CandidateAgg[], failed: "reddit_aggregate_failed" };
      }
      const rows = (data ?? []) as Array<{
        brand_normalized: string;
        raw_brand: string;
        mention_count: number;
        au_count: number;
      }>;
      return {
        rows: rows.map((r) => ({
          brandNormalized: r.brand_normalized,
          rawBrand: r.raw_brand,
          mentionCount: r.mention_count,
          auCount: r.au_count,
        })),
        failed: null as string | null,
      };
    });
    const candidates = candidatesStep.rows;
    markDegraded(candidatesStep.failed);

    // 3. Drop (a) denylisted noise (platform names + non-AU brands), then
    //    (b) brands already watched (by canonical key OR alias, and also by
    //    the resolved canonical so a known-but-differently-spelled brand
    //    doesn't surface). What remains = unwatched, actively-impersonated.
    //    The SAME filter applies to every source (Reddit + reported-scams).
    // THE fix for the re-announce loop: this gate must see the ACTIVE
    // watchlist (static + verified overlay brands), not the compile-time
    // array. Fed the static array while promotion writes to the overlay, a
    // promoted brand stays permanently "unwatched" here and gets re-surfaced
    // as a brand-new candidate every single week.
    const activeWatchlist = await step.run("load-active-watchlist", async () =>
      getActiveWatchlist(),
    );
    const watched = buildWatchedKeySet(activeWatchlist);
    const isFreshCandidate = (c: CandidateAgg): boolean => {
      if (CANDIDATE_DENYLIST.has(c.brandNormalized)) return false;
      if (watched.has(c.brandNormalized)) return false;
      const canonical = resolveCanonical(c.rawBrand);
      const canonicalKey = canonical ? brandNormalize(canonical) : null;
      if (canonicalKey && watched.has(canonicalKey)) return false;
      return true;
    };
    const fresh = candidates.filter(isFreshCandidate);

    // 3b. Second source (Phase 1, flag-gated): brands people REPORT to Arthur as
    //     impersonated — a windowed, read-only aggregate over scam_reports (no
    //     write, no index on the hot table; server-side GROUP BY so only
    //     aggregated rows ship). Same 30-day window + threshold + fresh-filter
    //     as Reddit. When FF_SCAM_BRANDS_SOURCE is OFF the step returns nothing
    //     and the Reddit path is unchanged.
    const scamStep = await step.run("aggregate-scam-brands", async () => {
      // Flag OFF is a DELIBERATE empty, not a degradation — do not report it as
      // one, or the digest cries wolf for the entire life of the flag.
      if (!featureFlags.scamBrandsSource) {
        return { rows: [] as CandidateAgg[], failed: null as string | null };
      }
      const sb = createServiceClient();
      if (!sb) return { rows: [] as CandidateAgg[], failed: "no_db_client" };
      const since = new Date(
        Date.now() - WINDOW_DAYS * 24 * 3600 * 1000,
      ).toISOString();
      const { data, error } = await sb.rpc("aggregate_scam_report_brands", {
        p_since: since,
        p_min_count: SCAM_REPORT_THRESHOLD,
      });
      if (error) {
        logger.error("reddit-brands-discover: scam-brand aggregate failed", {
          error: error.message,
        });
        return { rows: [] as CandidateAgg[], failed: "scam_aggregate_failed" };
      }
      const rows = (data ?? []) as Array<{
        brand_normalized: string;
        raw_brand: string;
        mention_count: number;
      }>;
      const mapped = rows.map((r) => ({
        brandNormalized: r.brand_normalized,
        rawBrand: r.raw_brand,
        mentionCount: r.mention_count,
        // Every scam_reports row is AU-attributable by construction: it was
        // submitted by a user of an Australian consumer scam-checker. Unlike
        // the Reddit stream, this source needs no geographic inference — which
        // is precisely why it is the stronger promotion signal despite its
        // much smaller volume.
        auCount: r.mention_count,
      }));
      return { rows: mapped, failed: null as string | null };
    });
    const scamCandidatesRaw = scamStep.rows;
    markDegraded(scamStep.failed);
    const scamFresh = scamCandidatesRaw.filter(isFreshCandidate);

    // 3c. Which fresh candidates (from EITHER source) have we NOT surfaced
    //     before? The digest fires only on genuinely new brands — the table
    //     already holds the standing list, so re-announcing it weekly is noise.
    const knownStep = await step.run("load-existing-candidates", async () => {
      const sb = createServiceClient();
      if (!sb) return { rows: [] as string[], failed: "no_db_client" };
      const keys: string[] = [];
      for (let from = 0; ; from += 1000) {
        // ORDER BY is load-bearing, not cosmetic: Postgres gives no stable row
        // order across separate queries, so an unordered .range() walk can skip
        // or repeat rows once the table exceeds one page. A SKIPPED key here
        // reads as "this brand is net-new" and re-announces a brand already in
        // the queue — the exact failure this step exists to prevent.
        const { data, error } = await sb
          .from("reddit_watchlist_candidates")
          .select("brand_normalized")
          .order("brand_normalized", { ascending: true })
          .range(from, from + 999);
        if (error) {
          logger.warn("reddit-brands-discover: existing-candidate load failed", {
            error: error.message,
          });
          // Fail CLOSED. A partial key set is worse than none: every key we
          // failed to read looks net-new, so a transient error would announce
          // the whole standing queue as fresh discoveries.
          return { rows: [] as string[], failed: "existing_candidates_partial" };
        }
        for (const r of data ?? []) keys.push(r.brand_normalized as string);
        if ((data?.length ?? 0) < 1000) break;
      }
      return { rows: keys, failed: null as string | null };
    });
    markDegraded(knownStep.failed);
    const knownCandidates = new Set(knownStep.rows);

    // Merge the two sources into one per-brand view for the digest, then keep
    // only the genuinely net-new brands (the DB stores the summed count).
    //
    // When the existing-candidate read failed we cannot tell net-new from
    // standing, so we announce NOTHING as new rather than everything. The
    // upserts below still run — the table stays current; only the digest's
    // "new" claim is withheld, and the degraded line says why.
    const newlySurfaced = knownStep.failed
      ? []
      : mergeCandidateSources(fresh, scamFresh).filter(
          (m) => !knownCandidates.has(m.brandNormalized),
        );

    // 4. Upsert every fresh candidate from both sources (status-preserving RPC —
    //    never resets a dismissed candidate to pending). Each source writes its
    //    own count and the RPC recomputes the total; only the net-new brands
    //    drive the digest below.
    const upsertStep = await step.run("upsert-candidates", async () => {
      const attempted = fresh.length + scamFresh.length;
      const sb = createServiceClient();
      if (!sb) return { ok: 0, attempted, failed: "no_db_client" };
      let n = 0;
      const upsertOne = async (
        c: CandidateAgg,
        source: "reddit" | "scam_reports",
      ) => {
        // v254 6-arg overload. The 5-arg v196 form still exists in the DB so
        // the migration could be applied ahead of this code shipping; do not
        // drop it until this deploy is live everywhere. Note .rpc() is untyped
        // (createServiceClient omits the <Database> generic), so an argument
        // mismatch here fails at RUNTIME as PGRST202, not at typecheck —
        // rpcs.smoke.test.ts is the gate.
        const { error } = await sb.rpc("upsert_watchlist_candidate", {
          p_brand_normalized: c.brandNormalized,
          p_raw_brand: c.rawBrand,
          p_source: source,
          p_source_count: c.mentionCount,
          p_au_count: c.auCount,
          p_resolved_canonical: resolveCanonical(c.rawBrand),
        });
        if (error) {
          logger.warn("reddit-brands-discover: upsert failed", {
            brand: c.rawBrand,
            source,
            error: error.message,
          });
          return;
        }
        n++;
      };
      for (const c of fresh) await upsertOne(c, "reddit");
      for (const c of scamFresh) await upsertOne(c, "scam_reports");
      // A partial write was previously invisible: `n` counted successes and
      // nothing compared it to the attempt count, so 3-of-46 and 46-of-46 both
      // returned a plausible-looking number.
      return {
        ok: n,
        attempted,
        failed: n < attempted ? "upserts_partial" : (null as string | null),
      };
    });
    const upserted = upsertStep.ok;
    markDegraded(upsertStep.failed);

    // 4b. AUTO-PROMOTION (FF_BRAND_AUTO_PROMOTE, default OFF).
    //
    //     Only candidates that clear meetsPromotionBar() AND have a domain in
    //     a trusted store are promoted unattended. The domain comes from
    //     known_brands (human-seeded in v179, plus RFC 9116 security.txt
    //     discoveries) — never from guessing `<brand>.com.au`, because
    //     legitimate_domains is the matcher's EXCLUSION list and a wrong entry
    //     creates a permanent blind spot rather than a missed alert.
    //
    //     Runs against ALL fresh candidates, not just net-new ones: a brand
    //     that was surfaced weeks ago and has since accumulated AU evidence is
    //     exactly the case auto-promotion exists for.
    const allFresh = mergeCandidateSources(fresh, scamFresh);
    const autoPromote = featureFlags.brandAutoPromote;

    const domainsStep = await step.run("load-trusted-domains", async () => {
      type Pair = [string, { domain: string; source: string }];
      const eligible = allFresh.filter(meetsPromotionBar);
      // Neither of these is a degradation: the flag being off is a decision, and
      // "nothing clears the promotion bar" is the expected steady state at
      // current volume (see the AU-evidence note above).
      if (!autoPromote || eligible.length === 0) {
        return { rows: [] as Pair[], failed: null as string | null };
      }
      const sb = createServiceClient();
      if (!sb) return { rows: [] as Pair[], failed: "no_db_client" };
      // Key on brandNormalize(brand_name), NOT on known_brands.brand_key.
      //
      // Those are two different conventions and they only coincide by accident:
      // brand_key is written by deriveBrandKey(), which replaces runs of
      // non-alphanumerics with "_" ("Australia Post" -> "australia_post"),
      // while candidates are keyed by brandNormalize(), which STRIPS them
      // ("australiapost"). Measured 2026-07-30: 140 of 307 known_brands rows
      // have brand_key <> brand_normalize(brand_name) — 46% of the domain
      // store, and precisely the multi-word AU brands that matter most
      // (Australia Post, Commonwealth Bank, JB Hi-Fi, Chemist Warehouse).
      // Matching on brand_key silently resolved NO domain for any of them, so
      // they could never be auto-promoted and the digest told the operator a
      // domain was needed for brands whose domain we already hold.
      //
      // Deriving the key from brand_name through the SAME normaliser the
      // candidates use makes a convention drift structurally impossible. Costs
      // a full read of a 307-row cold table once a week.
      const { data, error } = await sb
        .from("known_brands")
        .select("brand_name, brand_domain");
      if (error) {
        logger.warn("reddit-brands-discover: trusted-domain load failed", {
          error: error.message,
        });
        // This one matters: a failed read makes every eligible brand look like
        // it "needs a confirmed domain", so the operator is asked to supply
        // domains we already hold. Exactly the misreport #878 fixed, via a
        // different route.
        return { rows: [] as Pair[], failed: "trusted_domains_failed" };
      }
      const wanted = new Set(eligible.map((c) => c.brandNormalized));
      const out: Pair[] = [];
      for (const r of data ?? []) {
        const key = brandNormalize(r.brand_name as string | null);
        const domain = (r.brand_domain as string | null)?.trim();
        if (!key || !domain || !wanted.has(key)) continue;
        out.push([key, { domain, source: "known_brands" }]);
      }
      return { rows: out, failed: null as string | null };
    });
    markDegraded(domainsStep.failed);

    const { promote, needsDomain } = autoPromote
      ? planPromotions(allFresh, new Map(domainsStep.rows))
      : { promote: [] as PromotionPlan[], needsDomain: [] as MergedCandidate[] };

    const promotedStep = await step.run("auto-promote", async () => {
      if (promote.length === 0) {
        return { rows: [] as string[], failed: null as string | null };
      }
      const sb = createServiceClient();
      if (!sb) return { rows: [] as string[], failed: "no_db_client" };
      const done: string[] = [];
      for (const p of promote) {
        // One transaction per brand: the RPC writes monitored_brands AND moves
        // the candidate to 'promoted' together. Split apart, a failure between
        // them leaves a brand that is monitored and simultaneously
        // re-announced as unwatched every week.
        const { error } = await sb.rpc("promote_watchlist_candidate", {
          p_brand_normalized: p.brandNormalized,
          p_brand_name: p.brandName,
          p_domains: p.domains,
          p_aliases: [],
          p_note: `Auto-promoted: AU ${p.au}, reported ${p.scam}, total ${p.total}. Domain from ${p.domainSource}.`,
          p_source: "auto",
        });
        if (error) {
          logger.error("reddit-brands-discover: auto-promotion failed", {
            brand: p.brandName,
            error: error.message,
          });
          continue;
        }
        done.push(p.brandName);
      }
      // A brand that cleared the bar, had a domain, and STILL was not promoted
      // is the most consequential silent failure in this function: it will be
      // re-planned every week and never announced as a problem.
      return {
        rows: done,
        failed:
          done.length < promote.length
            ? "promotions_partial"
            : (null as string | null),
      };
    });
    const promoted = promotedStep.rows;
    markDegraded(promotedStep.failed);

    // 5. Telegram digest. Two changes from the original weekly ping:
    //
    //    (a) The ACTIONABLE list is AU-evidenced candidates only. Announcing
    //        by global mention count produced the 2026-07-26 digest — Xfinity,
    //        NextDoor, Chime, Capital One, all at exactly the ≥3 floor, none
    //        with an AU consumer surface. Asking a human to triage that is how
    //        the queue reached 51 rows with zero ever actioned.
    //    (b) The global-only remainder is NOT hidden — it gets one summary
    //        line naming the biggest few, because silently dropping candidates
    //        is how a discovery feature quietly stops discovering. Everything
    //        is still written to reddit_watchlist_candidates either way.
    //    (c) Anything auto-promoted in step 4b is removed first — see
    //        partitionForDigest(). A brand cannot be both "not yet on the
    //        watchlist" and "just added to the watchlist" in one message.
    const promotedKeys = new Set(
      promote
        .filter((p) => promoted.includes(p.brandName))
        .map((p) => p.brandNormalized),
    );
    const { auEvidenced, globalOnly } = partitionForDigest(
      newlySurfaced,
      promotedKeys,
    );

    // ALWAYS send — a weekly job that goes silent when healthy is
    // indistinguishable from a weekly job that has broken, and this one WILL
    // be silent in its steady state: measured 2026-07-30 against real prod
    // data, every AU-evidenced brand in the window was already watched,
    // denylisted, or already in the queue, so all four lists were empty and
    // the old condition sent nothing at all. Seven days of silence that could
    // equally mean "nothing new" or "the cron is dead" is not an acceptable
    // signal for the one job whose entire purpose is to tell you what is new.
    // Same reasoning as the cost digest's unconditional send: a quiet week is
    // information too, but only if it arrives.
    const degraded = [...degradedSet];

    await step.run("telegram", async () => {
      await sendAdminTelegramMessage(
        buildDigestMessage({
          auEvidenced,
          globalOnly,
          promote,
          promoted,
          needsDomain,
          candidatesExamined: candidates.length,
          scamExamined: scamCandidatesRaw.length,
          upserted,
          upsertAttempted: upsertStep.attempted,
          degraded,
          hasAlias: (raw) => resolveCanonical(raw) !== null,
        }),
      );
    });

    const summary = {
      candidates: candidates.length,
      fresh: fresh.length,
      scamFresh: scamFresh.length,
      newlySurfaced: newlySurfaced.length,
      auEvidenced: auEvidenced.length,
      globalOnly: globalOnly.length,
      autoPromote,
      promoted: promoted.length,
      needsDomain: needsDomain.length,
      upserted,
      upsertAttempted: upsertStep.attempted,
      degraded: degraded.length > 0,
      degradedReasons: degraded,
    };

    // ONE always-ship Axiom event per run. `warn` deliberately, not `info`:
    // info is sampled to 10% in prod, and at 52 runs a year that left ~5
    // observable runs — so "did Monday's run happen, and what did it see?" was
    // unanswerable from Axiom. `logger.info` below cannot fill the gap either;
    // it is console-only (no Axiom transport). One event a week is free.
    const alog = getLogger({
      source: "inngest",
      requestId: runId,
      fn: "reddit-brands-discover",
    });
    alog.warn("reddit-brands-discover.summary", summary);
    void alog.flush();

    logger.info("reddit-brands-discover: complete", summary);
    return { ok: true, ...summary };
  }),
);
