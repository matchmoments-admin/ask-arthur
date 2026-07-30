/**
 * Feed-health classification — the decision half of /api/cron/health-digest.
 *
 * Extracted from the route so the four verdicts can be tested directly. The old
 * implementation had one notion of "stale" and it was wrong in three separate
 * ways at once (measured 2026-07-30, see migration-v261):
 *
 *   - it read `.limit(500)` from feed_ingestion_log, which spanned 6.7 days and
 *     15 of 20 feeds — the 5 absent were exactly the dead ones, because a feed
 *     that stops writing drops out of any query that groups by what is present;
 *   - it measured staleness from MAX(created_at) of ANY status, so a feed
 *     latched in backoff (writing a partial every ~1.8h) read as permanently
 *     1.8h fresh while having zero successes in 1,167 runs;
 *   - it muted 12 feeds via a hardcoded Set, 7 of which were actively producing,
 *     including 5 of the top 6 by volume.
 *
 * Net effect: it printed "all clear" while three non-muted feeds were 31-86 days
 * dead. The roster and per-feed expectations now come from feed_sources via the
 * feed_health view; this module only decides.
 */

/**
 * The four failure kinds the single "stale" check used to conflate. They are
 * genuinely different and want different responses.
 */
export type FeedProblemKind =
  /** Enabled in the roster but has logged nothing. Only detectable by starting
   *  from the roster and LEFT JOINing the log. Hid acnc_register (86d) and
   *  pfra_members (82d) completely. */
  | "absent"
  /** Runs, but has never once logged status='success'. acsc: 0 successes in
   *  1,167 runs. */
  | "never_succeeds"
  /** Succeeded before, but not recently enough for its declared cadence. */
  | "stale"
  /** Succeeds on schedule and ingests nothing. phishing_database: 244 runs, all
   *  success, records_fetched=0 on every one, because its upstream returns
   *  HTTP 200 with a 1-byte body. */
  | "silent_success";

export interface FeedProblem {
  feed_name: string;
  kind: FeedProblemKind;
  detail: string;
}

/** Shape of a public.feed_health row (migration-v261). */
export interface FeedHealthRow {
  feed_name: string;
  poll_schedule: string | null;
  expect_new_rows_days: number | null;
  is_muted: boolean;
  muted_reason: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_useful_at: string | null;
  runs_7d: number;
  new_rows_7d: number;
  hours_since_success: number | null;
  days_since_useful: number | null;
}

export const KIND_RANK: Record<FeedProblemKind, number> = {
  absent: 0,
  never_succeeds: 1,
  stale: 2,
  silent_success: 3,
};

/**
 * Liveness threshold DERIVED from the feed's declared cadence, so adding a feed
 * cannot forget to add a threshold — the previous hand-maintained map is how
 * `acsc: 999` came to permanently hide a dead feed.
 *
 * GitHub's cron dispatch is heavily delayed (median ~114 min, p90 175, max 259
 * measured over 414 runs), so the allowance must be generous or a healthy
 * 3-hourly feed alarms on jitter alone.
 */
export function livenessThresholdHours(pollSchedule: string | null): number {
  const s = (pollSchedule ?? "").toLowerCase();
  const everyN = s.match(/every\s+(\d+)\s*h/);
  const intervalHours = everyN
    ? Number(everyN[1])
    : s.includes("weekly")
      ? 168
      : 24; // daily / event-driven / on-demand / unknown → treat as daily

  // Two intervals, or one interval plus 12h of slack, whichever is larger.
  return Math.max(intervalHours * 2, intervalHours + 12);
}

/**
 * Classify every enabled feed. Muted feeds are excluded from problems but
 * counted, so a mute can never make a feed fully invisible — and mutes carry an
 * expiry (feed_sources.muted_until) so they cannot rot the way the hardcoded
 * Set did.
 */
export function classifyFeedHealth(rows: FeedHealthRow[]): {
  problems: FeedProblem[];
  mutedCount: number;
  checked: number;
} {
  const problems: FeedProblem[] = [];
  let mutedCount = 0;

  for (const r of rows) {
    if (r.is_muted) {
      mutedCount += 1;
      continue;
    }

    if (r.last_run_at === null) {
      problems.push({
        feed_name: r.feed_name,
        kind: "absent",
        detail: `enabled but has logged nothing in 90d (schedule: ${r.poll_schedule ?? "unknown"})`,
      });
      continue;
    }

    if (r.last_success_at === null) {
      problems.push({
        feed_name: r.feed_name,
        kind: "never_succeeds",
        detail: `${r.runs_7d} run${r.runs_7d === 1 ? "" : "s"} in 7d, zero successes ever`,
      });
      continue;
    }

    const threshold = livenessThresholdHours(r.poll_schedule);
    // NULL must read as infinitely stale, never as "no data so probably fine".
    const hoursSince = r.hours_since_success ?? Number.POSITIVE_INFINITY;
    if (hoursSince > threshold) {
      problems.push({
        feed_name: r.feed_name,
        kind: "stale",
        detail: `${hoursSince.toFixed(1)}h since last success (threshold ${threshold}h, schedule: ${r.poll_schedule ?? "unknown"})`,
      });
      continue;
    }

    // Productivity is opt-in per feed: 0 new rows is CORRECT for a static
    // upstream (feodo's list is 5 entries) or a staleness keep-alive (crtsh).
    if (r.expect_new_rows_days !== null) {
      const daysSinceUseful = r.days_since_useful ?? Number.POSITIVE_INFINITY;
      if (daysSinceUseful > r.expect_new_rows_days) {
        const when = Number.isFinite(daysSinceUseful)
          ? `${daysSinceUseful.toFixed(1)}d`
          : "never";
        problems.push({
          feed_name: r.feed_name,
          kind: "silent_success",
          detail: `succeeding, but last new row ${when} ago (expected within ${r.expect_new_rows_days}d)`,
        });
      }
    }
  }

  problems.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.feed_name.localeCompare(b.feed_name),
  );

  return { problems, mutedCount, checked: rows.length };
}
