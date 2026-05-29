import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { logCost } from "@/lib/cost-telemetry";

/**
 * PR-D1 (#497) — Weekly FP-cluster digest.
 *
 * The operator marks ~5–10 FP per matcher-noisy day. That data sits in
 * `shopfront_clone_alerts.triage_status='fp'` and nothing reads it back.
 * The matcher keeps firing on the same FP shapes — `bondi.design`
 * matches "Bonds" weekly, `jeleven.online` matches "7-Eleven" daily.
 *
 * This function clusters the trailing 14-day FP set by
 *   (brand × candidate-TLD × first-N-char-prefix of label)
 * and surfaces clusters with ≥3 hits as proposed matcher exceptions.
 * The operator copy-pastes the exception line into
 * `packages/shopfront-glue/src/au-brand-watchlist.ts` if they agree.
 * We DO NOT auto-apply the exception — keeps the human in the loop on
 * what's essentially a policy decision about brand-coverage scope.
 *
 * Cron: Sunday 09:00 UTC. Sized for low signal-to-noise — daily would
 * be 7x the noise with the same value-per-week.
 *
 * Cost: $0. No external API calls; pure DB + Telegram.
 */

export interface FpRow {
  brand: string;            // inferred_target_domain
  candidate_domain: string;
}

export interface FpCluster {
  brand: string;
  tld: string;              // last label of the candidate (e.g. "design", "shop")
  prefix: string;           // first N chars of the candidate's primary label
  count: number;
  examples: string[];       // up to 3 candidate_domain samples
  proposed_exception: string;
}

const CLUSTER_PREFIX_LEN = 5;
const MIN_CLUSTER_SIZE = 3;
const WINDOW_DAYS = 14;
const MAX_EXAMPLES = 3;

export const cloneWatchFpClusterDigest = inngest.createFunction(
  {
    id: "shopfront-clone-fp-cluster-digest",
    name: "Clone-Watch: Weekly FP-cluster digest",
    retries: 2,
    singleton: { mode: "skip" },
    timeouts: { finish: "5m" },
  },
  [
    // Moved off 0 9 (#524): the daily feedback-digest Vercel cron runs
    // `0 9 * * *` (every day incl. Sunday), so this weekly digest collided
    // with it every Sunday 09:00 UTC — the same PR-#431 deconfliction policy
    // the sibling weekly-digest (0 10) and urlscan-rescan (0 11) already follow.
    { cron: "30 9 * * 0" },
    { event: "shopfront/clone.fp-cluster-digest.manual-trigger.v1" },
  ],
  async ({ step }) => {
    logger.info("clone-watch fp-cluster-digest: invoked");

    if (!featureFlags.shopfrontCloneWatch) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_WATCH disabled" };
    }

    const sb = createServiceClient();
    if (!sb) return { skipped: true, reason: "supabase_unavailable" };

    // Pull trailing-14d FP rows. We need the brand (inferred_target_domain)
    // and the candidate_domain. Bounded result set — at ~5 FP/day × 14 =
    // ~70 rows; even a 10x noise spike (700 rows) stays well under the
    // pg_stat_statements query budget.
    const rows = await step.run("load-recent-fps", async () => {
      const sinceIso = new Date(
        Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await sb
        .from("shopfront_clone_alerts")
        .select("inferred_target_domain, candidate_domain")
        .eq("triage_status", "fp")
        .gte("triage_at", sinceIso)
        .limit(5000);
      if (error) {
        throw new Error(`load-recent-fps: ${error.message}`);
      }
      return (
        (data as Array<{
          inferred_target_domain: string;
          candidate_domain: string;
        }> | null) ?? []
      ).map((r) => ({
        brand: r.inferred_target_domain,
        candidate_domain: r.candidate_domain,
      })) as FpRow[];
    });

    if (rows.length === 0) {
      logger.info("clone-watch fp-cluster-digest: no FPs in window");
      return { ok: true, clusters: 0, window_days: WINDOW_DAYS };
    }

    const clusters = summariseFpClusters(rows);

    if (clusters.length === 0) {
      logger.info(
        "clone-watch fp-cluster-digest: no clusters ≥ threshold",
        { fp_count: rows.length, min_cluster_size: MIN_CLUSTER_SIZE },
      );
      return {
        ok: true,
        clusters: 0,
        fp_count: rows.length,
        reason: "no_clusters_above_threshold",
      };
    }

    await step.run("notify-admin-digest", async () => {
      await sendAdminTelegramMessage(buildTelegramMessage(clusters, rows.length));
    });

    logCost({
      feature: "shopfront_clone_fp_cluster_digest",
      provider: "telegram",
      operation: "weekly_digest",
      units: 0,
      unitCostUsd: 0,
      metadata: {
        clusters: clusters.length,
        fp_count: rows.length,
        window_days: WINDOW_DAYS,
      },
    });

    logger.info("clone-watch fp-cluster-digest: done", {
      clusters: clusters.length,
      fp_count: rows.length,
    });

    return {
      ok: true,
      clusters: clusters.length,
      fp_count: rows.length,
      window_days: WINDOW_DAYS,
    };
  },
);

// ── Pure helpers (exported for unit testing) ─────────────────────────────

/**
 * Build the cluster bucket key for a FP row. Two dimensions:
 *   1. brand — same brand can be misfired on by multiple matcher rules
 *   2. tld   — `.design` and `.shop` tend to have very different scam
 *              vs noise patterns; clustering across TLDs loses signal
 *
 * The third "prefix" dimension is NOT a bucket key — it's computed after
 * bucketing as the longest-common-prefix of the candidate labels inside
 * the bucket. Using prefix as a key over-clustered: `bondi.design` and
 * `bondx.design` would land in different buckets despite obviously being
 * the same matcher-noise shape. Exported for tests.
 */
export function buildClusterKey(row: FpRow): {
  key: string;
  brand: string;
  tld: string;
} {
  const labels = row.candidate_domain.toLowerCase().split(".");
  const tld = labels.length > 0 ? labels[labels.length - 1]! : "";
  const key = `${row.brand}|${tld}`;
  return { key, brand: row.brand, tld };
}

/**
 * Longest common prefix of an array of strings, capped at CLUSTER_PREFIX_LEN.
 * Returns "" if no common prefix exists. Used to derive a proposed
 * exception regex from a bucket of FP candidates.
 *
 * Examples:
 *   ["bondi.design", "bondx.design", "bondy.design"]  → "bond"
 *   ["stakemax.shop", "stakefoo.shop", "payouts.shop"] → "" (no common stem)
 */
export function longestCommonPrefix(candidates: string[]): string {
  if (candidates.length === 0) return "";
  const primaries = candidates.map((c) => (c.toLowerCase().split(".")[0] ?? c));
  let prefix = primaries[0]!;
  for (let i = 1; i < primaries.length; i++) {
    const other = primaries[i]!;
    let j = 0;
    const max = Math.min(prefix.length, other.length);
    while (j < max && prefix[j] === other[j]) j++;
    prefix = prefix.slice(0, j);
    if (!prefix) return "";
  }
  return prefix.slice(0, CLUSTER_PREFIX_LEN);
}

/**
 * Cluster the FP rows by (brand × tld), keep only clusters with
 * ≥ MIN_CLUSTER_SIZE hits, sort by count DESC. For each cluster, derive
 * a longest-common-prefix from the candidate set and produce a proposed
 * matcher-exception regex the operator can paste into
 * au-brand-watchlist.ts.
 *
 * Exported for unit testing.
 */
export function summariseFpClusters(rows: FpRow[]): FpCluster[] {
  const buckets = new Map<
    string,
    {
      brand: string;
      tld: string;
      candidates: string[];
    }
  >();

  for (const row of rows) {
    const { key, brand, tld } = buildClusterKey(row);
    const existing = buckets.get(key);
    if (existing) {
      existing.candidates.push(row.candidate_domain);
    } else {
      buckets.set(key, {
        brand,
        tld,
        candidates: [row.candidate_domain],
      });
    }
  }

  const clusters: FpCluster[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.candidates.length < MIN_CLUSTER_SIZE) continue;
    const prefix = longestCommonPrefix(bucket.candidates);
    clusters.push({
      brand: bucket.brand,
      tld: bucket.tld,
      prefix,
      count: bucket.candidates.length,
      examples: bucket.candidates.slice(0, MAX_EXAMPLES),
      proposed_exception: buildProposedException(prefix, bucket.tld),
    });
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

/**
 * Render a proposed matcher-exception regex line for a cluster. The
 * operator decides whether to apply it — we never auto-apply.
 *
 * When a longest-common-prefix exists, shape is
 *   `/^<prefix>[a-z0-9-]*\.<tld>$/` (start-anchored).
 * When no LCP (heterogeneous candidates in the same bucket), fall back
 * to a TLD-only suggestion `(see candidates)` — the operator inspects
 * the examples and decides whether the TLD itself is the noise source.
 */
export function buildProposedException(prefix: string, tld: string): string {
  if (!prefix) {
    return `(no common prefix — review TLD .${tld} candidates and decide)`;
  }
  return `/^${prefix}[a-z0-9-]*\\.${tld}$/`;
}

/**
 * Build the Telegram digest message. Markdown is the default rendering
 * inside the existing admin-telegram helper. Keep < ~4000 chars to stay
 * inside the Telegram message limit; we cap at 15 clusters which is
 * already a strong signal that the matcher needs a release.
 */
export function buildTelegramMessage(
  clusters: FpCluster[],
  totalFps: number,
): string {
  const header = [
    `📋 <b>Clone-watch — FP patterns (last ${WINDOW_DAYS}d)</b>`,
    ``,
    `<b>${totalFps}</b> total FPs · <b>${clusters.length}</b> repeat patterns`,
    ``,
  ];

  const shown = clusters.slice(0, 15);
  const body = shown.map((c) => {
    const exampleList = c.examples
      .map((e) => `<code>${escapeHtml(e)}</code>`)
      .join(", ");
    return [
      `• <b>${escapeHtml(c.brand)}</b> — <b>${c.count}</b> FPs on <code>.${escapeHtml(c.tld)}</code>`,
      `  ${exampleList}`,
      `  Proposed exception: <code>${escapeHtml(c.proposed_exception)}</code>`,
    ].join("\n");
  });

  const overflow = clusters.length > shown.length
    ? [``, `+${clusters.length - shown.length} smaller clusters omitted`]
    : [];

  const footer = [
    ``,
    `Apply by editing <code>packages/shopfront-glue/src/au-brand-watchlist.ts</code> if you agree.`,
  ];

  return [...header, ...body, ...overflow, ...footer].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
