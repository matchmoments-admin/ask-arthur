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
 * No paid API (pure SQL read + in-process brandNormalize), so no cost brake —
 * runtime cost is effectively $0. Weekly cadence; pulls a bounded window.
 */

const WINDOW_DAYS = 30;
// A brand named in >= this many Reddit posts in the window is worth surfacing.
const MENTION_THRESHOLD = 3;
// Cap how many candidates the Telegram digest lists (the table holds them all).
const DIGEST_CAP = 25;

// Brands that are never useful clone-watch candidates for an AU-focused
// watchlist, so they're dropped before BOTH the table upsert and the digest
// (they were the bulk of the weekly noise):
//   (a) Platform names the upstream classifier mis-tags as "impersonated" when
//       a scam merely happened ON that platform (Reddit/Discord/Marketplace…).
//   (b) US-only / non-AU brands with no AU consumer-impersonation surface.
// Extend as new noise surfaces. Matched on brandNormalize() (same normaliser
// the aggregator uses), so casing/spacing variants collapse to one key.
const CANDIDATE_DENYLIST_RAW: readonly string[] = [
  // (a) Platforms — scam venue, not an impersonated brand
  "Reddit", "Discord", "LinkedIn", "Facebook", "Facebook Marketplace", "Meta",
  "Instagram", "TikTok", "Telegram", "WhatsApp", "Steam", "Shop", "X", "Twitter",
  "YouTube", "Snapchat",
  // (b) US-only / non-AU brands
  "Cash App", "Venmo", "Zelle", "Wells Fargo", "Bank of America", "Chase",
  "Robinhood", "MrBeast",
];
// Exported for testing. Holds brandNormalize() keys, not raw labels.
export const CANDIDATE_DENYLIST = new Set(
  CANDIDATE_DENYLIST_RAW.map((b) => brandNormalize(b)).filter(Boolean),
);

interface CandidateAgg {
  brandNormalized: string;
  rawBrand: string;
  mentionCount: number;
}

/** Aggregate brands_impersonated rows into per-canonical-key mention counts.
 *  Pure + unit-tested: one count per distinct normalized brand per POST (a post
 *  listing the same brand twice counts once), keeping a representative raw
 *  string. Exported for testing. */
export function aggregateBrandMentions(
  rows: Array<{ brands_impersonated: string[] | null }>,
): Map<string, CandidateAgg> {
  const agg = new Map<string, CandidateAgg>();
  for (const row of rows) {
    const seenThisPost = new Set<string>();
    for (const raw of row.brands_impersonated ?? []) {
      const norm = brandNormalize(raw);
      if (!norm || seenThisPost.has(norm)) continue;
      seenThisPost.add(norm);
      const existing = agg.get(norm);
      if (existing) existing.mentionCount += 1;
      else agg.set(norm, { brandNormalized: norm, rawBrand: raw.trim(), mentionCount: 1 });
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

    // 2. Aggregate brand mentions over the window.
    const candidates = await step.run("aggregate-mentions", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as CandidateAgg[];
      const since = new Date(
        Date.now() - WINDOW_DAYS * 24 * 3600 * 1000,
      ).toISOString();
      const { data, error } = await sb
        .from("reddit_post_intel")
        .select("brands_impersonated")
        .gt("processed_at", since);
      if (error) {
        logger.error("reddit-brands-discover: mention query failed", {
          error: error.message,
        });
        return [] as CandidateAgg[];
      }
      const agg = aggregateBrandMentions(data ?? []);
      return [...agg.values()].filter((c) => c.mentionCount >= MENTION_THRESHOLD);
    });

    // 3. Drop (a) denylisted noise (platform names + non-AU brands), then
    //    (b) brands already watched (by canonical key OR alias, and also by
    //    the resolved canonical so a known-but-differently-spelled brand
    //    doesn't surface). What remains = unwatched, actively-impersonated.
    const watched = buildWatchedKeySet(AU_BRAND_WATCHLIST);
    const fresh = candidates.filter((c) => {
      if (CANDIDATE_DENYLIST.has(c.brandNormalized)) return false;
      if (watched.has(c.brandNormalized)) return false;
      const canonical = resolveCanonical(c.rawBrand);
      const canonicalKey = canonical ? brandNormalize(canonical) : null;
      if (canonicalKey && watched.has(canonicalKey)) return false;
      return true;
    });

    // 3b. Which of the fresh candidates have we NOT surfaced before? The
    //     digest fires only on genuinely new brands — the table already holds
    //     the standing list, so re-announcing it every week was pure noise.
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
    const newlySurfaced = fresh.filter((c) => !knownCandidates.has(c.brandNormalized));

    // 4. Upsert candidates (status-preserving RPC — never resets a dismissed
    //    candidate to pending). All fresh rows are upserted (keeps mention
    //    counts current); only the net-new ones drive the digest below.
    const upserted = await step.run("upsert-candidates", async () => {
      const sb = createServiceClient();
      if (!sb) return 0;
      let n = 0;
      for (const c of fresh) {
        const { error } = await sb.rpc("upsert_reddit_watchlist_candidate", {
          p_brand_normalized: c.brandNormalized,
          p_raw_brand: c.rawBrand,
          p_mention_count: c.mentionCount,
          p_resolved_canonical: resolveCanonical(c.rawBrand),
        });
        if (error) {
          logger.warn("reddit-brands-discover: upsert failed", {
            brand: c.rawBrand,
            error: error.message,
          });
          continue;
        }
        n++;
      }
      return n;
    });

    // 5. Telegram digest — ONLY when there are net-new candidates. Silent
    //    otherwise (logged below), so a stable list no longer re-pings weekly.
    if (newlySurfaced.length > 0) {
      await step.run("telegram", async () => {
        const top = [...newlySurfaced]
          .sort((a, b) => b.mentionCount - a.mentionCount)
          .slice(0, DIGEST_CAP);
        const lines = top.map(
          (c) =>
            `• <b>${c.rawBrand}</b> — ${c.mentionCount} mentions${
              resolveCanonical(c.rawBrand) ? " (known alias)" : ""
            }`,
        );
        const more =
          newlySurfaced.length > DIGEST_CAP
            ? [`…and ${newlySurfaced.length - DIGEST_CAP} more.`]
            : [];
        await sendAdminTelegramMessage(
          [
            `<b>Reddit brands discover</b>`,
            `<b>${newlySurfaced.length}</b> new brand(s) impersonated on Reddit (last ${WINDOW_DAYS}d, ≥${MENTION_THRESHOLD} mentions) — not yet on the clone-watch list. Add any worth monitoring to packages/shopfront-glue/src/au-brand-watchlist.ts:`,
            ...lines,
            ...more,
          ].join("\n"),
        );
      });
    }

    logger.info("reddit-brands-discover: complete", {
      candidates: candidates.length,
      fresh: fresh.length,
      newlySurfaced: newlySurfaced.length,
      upserted,
    });
    return {
      ok: true,
      candidates: candidates.length,
      fresh: fresh.length,
      newlySurfaced: newlySurfaced.length,
      upserted,
    };
  }),
);
