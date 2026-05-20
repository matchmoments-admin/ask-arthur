import type { SupabaseClient } from "@supabase/supabase-js";

export type RedditIntelClusterHealthVerdict =
  | "HEALTHY"
  | "NEEDS_RETUNING"
  | "DEGENERATE";

export interface RedditIntelClusterHealthThresholds {
  healthyMedianMin: number;
  healthyP95Max: number;
  degenerateP95Max: number;
  singletonMedian: number;
}

export interface RedditIntelClusterHealthTopTheme {
  id: string;
  slug: string;
  title: string;
  memberCount: number;
  postCount: number;
  wowDeltaPct: number | null;
  lastSeenAt: string | null;
}

export interface RedditIntelClusterHealthStats {
  totalThemeCount: number;
  totalPostCount: number;
  themePostRatio: number;
  memberCountMedian: number;
  memberCountP95: number;
  topThemesByRecentVelocity: RedditIntelClusterHealthTopTheme[];
}

export interface RedditIntelClusterHealthReport {
  verdict: RedditIntelClusterHealthVerdict;
  stats: RedditIntelClusterHealthStats;
  evidence: string;
  thresholds: RedditIntelClusterHealthThresholds;
}

interface RedditIntelThemeRow {
  id: string;
  slug: string | null;
  title: string | null;
  member_count: number | null;
  wow_delta_pct: number | string | null;
  last_seen_at: string | null;
}

interface RedditPostIntelThemeRow {
  intel_id: string;
  theme_id: string;
}

const DEFAULT_THRESHOLDS: RedditIntelClusterHealthThresholds = {
  healthyMedianMin: 3,
  healthyP95Max: 50,
  degenerateP95Max: 100,
  singletonMedian: 1,
};

const DEFAULT_TOP_THEME_LIMIT = 5;
const MAX_HEALTH_ROWS = 10_000;

export async function verifyRedditIntelClusterHealth(
  supabase: SupabaseClient,
  opts: {
    thresholds?: Partial<RedditIntelClusterHealthThresholds>;
    topThemeLimit?: number;
  } = {},
): Promise<RedditIntelClusterHealthReport> {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
  const topThemeLimit = opts.topThemeLimit ?? DEFAULT_TOP_THEME_LIMIT;

  const { data: themeRows, error: themeError } = await supabase
    .from("reddit_intel_themes")
    .select("id, slug, title, member_count, wow_delta_pct, last_seen_at")
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(MAX_HEALTH_ROWS);

  if (themeError) {
    throw new Error(
      `reddit_intel_themes health query failed: ${themeError.message}`,
    );
  }

  const { data: memberRows, error: memberError } = await supabase
    .from("reddit_post_intel_themes")
    .select("intel_id, theme_id")
    .limit(MAX_HEALTH_ROWS);

  if (memberError) {
    throw new Error(
      `reddit_post_intel_themes health query failed: ${memberError.message}`,
    );
  }

  const themes = (themeRows ?? []) as RedditIntelThemeRow[];
  const memberships = (memberRows ?? []) as RedditPostIntelThemeRow[];

  const activeThemeIds = new Set(themes.map((theme) => theme.id));
  const postsByTheme = new Map<string, Set<string>>();
  const uniquePosts = new Set<string>();
  for (const row of memberships) {
    if (!activeThemeIds.has(row.theme_id)) continue;
    uniquePosts.add(row.intel_id);
    const posts = postsByTheme.get(row.theme_id) ?? new Set<string>();
    posts.add(row.intel_id);
    postsByTheme.set(row.theme_id, posts);
  }

  const memberCounts = themes
    .map((theme) => Number(theme.member_count ?? 0))
    .filter((count) => Number.isFinite(count))
    .sort((a, b) => a - b);

  const totalThemeCount = themes.length;
  const totalPostCount = uniquePosts.size;
  const themePostRatio =
    totalPostCount === 0
      ? totalThemeCount === 0
        ? 0
        : Infinity
      : totalThemeCount / totalPostCount;
  const memberCountMedian = percentile(memberCounts, 0.5);
  const memberCountP95 = percentile(memberCounts, 0.95);

  const topThemesByRecentVelocity = themes
    .map((theme) => ({
      id: theme.id,
      slug: theme.slug ?? "",
      title: theme.title ?? "Untitled theme",
      memberCount: Number(theme.member_count ?? 0),
      postCount: postsByTheme.get(theme.id)?.size ?? 0,
      wowDeltaPct: normaliseNumber(theme.wow_delta_pct),
      lastSeenAt: theme.last_seen_at,
    }))
    .sort((a, b) => {
      const aVelocity = a.wowDeltaPct ?? Number.NEGATIVE_INFINITY;
      const bVelocity = b.wowDeltaPct ?? Number.NEGATIVE_INFINITY;
      if (aVelocity !== bVelocity) return bVelocity - aVelocity;
      if (a.lastSeenAt && b.lastSeenAt) {
        return (
          new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
        );
      }
      return b.memberCount - a.memberCount;
    })
    .slice(0, topThemeLimit);

  const stats: RedditIntelClusterHealthStats = {
    totalThemeCount,
    totalPostCount,
    themePostRatio,
    memberCountMedian,
    memberCountP95,
    topThemesByRecentVelocity,
  };

  const verdict = classifyClusterHealth(stats, thresholds);

  return {
    verdict,
    stats,
    thresholds,
    evidence: formatEvidence(verdict, stats, thresholds),
  };
}

function classifyClusterHealth(
  stats: RedditIntelClusterHealthStats,
  thresholds: RedditIntelClusterHealthThresholds,
): RedditIntelClusterHealthVerdict {
  if (
    stats.totalThemeCount > stats.totalPostCount ||
    stats.memberCountP95 > thresholds.degenerateP95Max
  ) {
    return "DEGENERATE";
  }

  if (stats.memberCountMedian <= thresholds.singletonMedian) {
    return "NEEDS_RETUNING";
  }

  if (
    stats.memberCountMedian >= thresholds.healthyMedianMin &&
    stats.memberCountP95 <= thresholds.healthyP95Max
  ) {
    return "HEALTHY";
  }

  return "NEEDS_RETUNING";
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil(p * sortedValues.length) - 1;
  return (
    sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)] ?? 0
  );
}

function normaliseNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatEvidence(
  verdict: RedditIntelClusterHealthVerdict,
  stats: RedditIntelClusterHealthStats,
  thresholds: RedditIntelClusterHealthThresholds,
): string {
  const ratio = Number.isFinite(stats.themePostRatio)
    ? stats.themePostRatio.toFixed(3)
    : "Infinity";
  const topThemes = stats.topThemesByRecentVelocity
    .map((theme) => {
      const velocity =
        theme.wowDeltaPct === null
          ? "no WoW delta"
          : `${theme.wowDeltaPct}% WoW`;
      return `${theme.title} (${theme.memberCount} members, ${velocity})`;
    })
    .join("; ");

  return [
    `Cluster health ${verdict}: ${stats.totalThemeCount} active themes across ${stats.totalPostCount} unique posts`,
    `theme:post ratio=${ratio}, median member_count=${stats.memberCountMedian}, p95 member_count=${stats.memberCountP95}`,
    `healthy band requires median >= ${thresholds.healthyMedianMin} and p95 <= ${thresholds.healthyP95Max}; degenerate if themes > posts or p95 > ${thresholds.degenerateP95Max}`,
    topThemes ? `top recent themes: ${topThemes}` : "top recent themes: none",
  ].join(". ");
}
