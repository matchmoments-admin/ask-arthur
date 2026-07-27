import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  AU_BRAND_WATCHLIST,
  brandNormalize,
  buildBrandResolver,
  type BrandAliasRecord,
} from "@askarthur/shopfront-glue";
import { createServiceClient } from "@askarthur/supabase/server";
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
 */

const WINDOW_DAYS = 30;
// A brand named in >= this many Reddit posts in the window is worth recording.
const MENTION_THRESHOLD = 3;
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

/** Build the set of normalized keys already covered by the watchlist —
 *  canonical brand names AND their aliases. Exported for testing. */
export function buildWatchedKeySet(
  watchlist: ReadonlyArray<{ brand: string; aliases?: string[] }>,
): Set<string> {
  const set = new Set<string>();
  for (const entry of watchlist) {
    const b = brandNormalize(entry.brand);
    if (b) set.add(b);
    for (const alias of entry.aliases ?? []) {
      const a = brandNormalize(alias);
      if (a) set.add(a);
    }
  }
  return set;
}

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

export const redditBrandsDiscover = inngest.createFunction(
  {
    id: "reddit-brands-discover",
    name: "Reddit Brands: watchlist candidate discovery",
    timeouts: { finish: "5m" },
    retries: 1,
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 7 * * 1" }, // weekly, Monday 07:00 UTC
    { event: "reddit-brands/discover.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "reddit-brands-discover" }, async ({ step }) => {
    if (!featureFlags.redditBrandsDiscover) {
      return { skipped: true, reason: "flag_off" };
    }

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
    const candidates = await step.run("aggregate-mentions", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as CandidateAgg[];
      const since = new Date(
        Date.now() - WINDOW_DAYS * 24 * 3600 * 1000,
      ).toISOString();
      const { data, error } = await sb.rpc("aggregate_reddit_brands_with_au", {
        p_since: since,
        p_min_count: MENTION_THRESHOLD,
      });
      if (error) {
        logger.error("reddit-brands-discover: mention query failed", {
          error: error.message,
        });
        return [] as CandidateAgg[];
      }
      const rows = (data ?? []) as Array<{
        brand_normalized: string;
        raw_brand: string;
        mention_count: number;
        au_count: number;
      }>;
      return rows.map((r) => ({
        brandNormalized: r.brand_normalized,
        rawBrand: r.raw_brand,
        mentionCount: r.mention_count,
        auCount: r.au_count,
      }));
    });

    // 3. Drop (a) denylisted noise (platform names + non-AU brands), then
    //    (b) brands already watched (by canonical key OR alias, and also by
    //    the resolved canonical so a known-but-differently-spelled brand
    //    doesn't surface). What remains = unwatched, actively-impersonated.
    //    The SAME filter applies to every source (Reddit + reported-scams).
    const watched = buildWatchedKeySet(AU_BRAND_WATCHLIST);
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
    const scamCandidatesRaw = await step.run("aggregate-scam-brands", async () => {
      if (!featureFlags.scamBrandsSource) return [] as CandidateAgg[];
      const sb = createServiceClient();
      if (!sb) return [] as CandidateAgg[];
      const since = new Date(
        Date.now() - WINDOW_DAYS * 24 * 3600 * 1000,
      ).toISOString();
      const { data, error } = await sb.rpc("aggregate_scam_report_brands", {
        p_since: since,
        p_min_count: MENTION_THRESHOLD,
      });
      if (error) {
        logger.error("reddit-brands-discover: scam-brand aggregate failed", {
          error: error.message,
        });
        return [] as CandidateAgg[];
      }
      const rows = (data ?? []) as Array<{
        brand_normalized: string;
        raw_brand: string;
        mention_count: number;
      }>;
      return rows.map((r) => ({
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
    });
    const scamFresh = scamCandidatesRaw.filter(isFreshCandidate);

    // 3c. Which fresh candidates (from EITHER source) have we NOT surfaced
    //     before? The digest fires only on genuinely new brands — the table
    //     already holds the standing list, so re-announcing it weekly is noise.
    const knownCandidateKeys = await step.run("load-existing-candidates", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as string[];
      const keys: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("reddit_watchlist_candidates")
          .select("brand_normalized")
          .range(from, from + 999);
        if (error) {
          logger.warn("reddit-brands-discover: existing-candidate load failed", {
            error: error.message,
          });
          break;
        }
        for (const r of data ?? []) keys.push(r.brand_normalized as string);
        if ((data?.length ?? 0) < 1000) break;
      }
      return keys;
    });
    const knownCandidates = new Set(knownCandidateKeys);

    // Merge the two sources into one per-brand view for the digest, then keep
    // only the genuinely net-new brands (the DB stores the summed count).
    const newlySurfaced = mergeCandidateSources(fresh, scamFresh).filter(
      (m) => !knownCandidates.has(m.brandNormalized),
    );

    // 4. Upsert every fresh candidate from both sources (status-preserving RPC —
    //    never resets a dismissed candidate to pending). Each source writes its
    //    own count and the RPC recomputes the total; only the net-new brands
    //    drive the digest below.
    const upserted = await step.run("upsert-candidates", async () => {
      const sb = createServiceClient();
      if (!sb) return 0;
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
      return n;
    });

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
    const auEvidenced = newlySurfaced
      .filter(hasAuEvidence)
      .sort((a, b) => b.au - a.au || b.total - a.total);
    const globalOnly = newlySurfaced
      .filter((m) => !hasAuEvidence(m))
      .sort((a, b) => b.total - a.total);

    if (auEvidenced.length > 0 || globalOnly.length > 0) {
      await step.run("telegram", async () => {
        const top = auEvidenced.slice(0, DIGEST_CAP);
        const lines = top.map((m) => {
          const parts: string[] = [];
          if (m.reddit > 0) parts.push(`Reddit ×${m.reddit}`);
          if (m.scam > 0) parts.push(`reported ×${m.scam}`);
          const aliasTag = resolveCanonical(m.rawBrand) ? " (known alias)" : "";
          // Always show the AU/global split so a 1-of-28 brand can't be
          // mistaken for a strong signal.
          return (
            `• <b>${m.rawBrand}</b> — ${parts.join(", ")} · ` +
            `<b>AU ${m.au}</b>/${m.total}${aliasTag}`
          );
        });
        const more =
          auEvidenced.length > DIGEST_CAP
            ? [`…and ${auEvidenced.length - DIGEST_CAP} more AU-evidenced.`]
            : [];

        const header =
          auEvidenced.length > 0
            ? `<b>${auEvidenced.length}</b> new brand(s) impersonated WITH Australian evidence ` +
              `(Reddit + reported scams, last ${WINDOW_DAYS}d, ≥${MENTION_THRESHOLD} mentions) — ` +
              `not yet on the clone-watch list:`
            : `No new AU-evidenced brands this week.`;

        // One line, not N — the global tail is context, not a worklist.
        const globalLine =
          globalOnly.length > 0
            ? [
                ``,
                `<i>Plus ${globalOnly.length} new global-only candidate(s) with no AU ` +
                  `evidence — recorded, not actioned: ` +
                  globalOnly
                    .slice(0, GLOBAL_ONLY_PREVIEW)
                    .map((m) => `${m.rawBrand} ×${m.total}`)
                    .join(", ") +
                  (globalOnly.length > GLOBAL_ONLY_PREVIEW ? ", …" : "") +
                  `</i>`,
              ]
            : [];

        await sendAdminTelegramMessage(
          [
            `<b>Brands discover</b>`,
            header,
            ...lines,
            ...more,
            ...globalLine,
            ``,
            `Review queue: https://askarthur.au/admin/brand-candidates`,
          ].join("\n"),
        );
      });
    }

    logger.info("reddit-brands-discover: complete", {
      candidates: candidates.length,
      fresh: fresh.length,
      scamFresh: scamFresh.length,
      newlySurfaced: newlySurfaced.length,
      auEvidenced: auEvidenced.length,
      globalOnly: globalOnly.length,
      upserted,
    });
    return {
      ok: true,
      candidates: candidates.length,
      fresh: fresh.length,
      scamFresh: scamFresh.length,
      newlySurfaced: newlySurfaced.length,
      auEvidenced: auEvidenced.length,
      globalOnly: globalOnly.length,
      upserted,
    };
  }),
);
