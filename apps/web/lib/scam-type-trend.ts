/**
 * Which scam types are growing, across both intelligence streams.
 *
 * This is the reader that makes the canonical taxonomy real. ADR-0020 records
 * what happens without one: the canonical brand layer shipped, read as
 * infrastructure, and sat with ZERO code callers for months while the problem
 * it solved carried on. A mapping nobody reads is a comment.
 *
 * The signal it surfaces was already sitting in the data. A single GROUP BY
 * over the last two 30-day windows showed sextortion up 44% month on month,
 * rental up 12%, tech support down 47% — and no surface anywhere would have
 * told you, because nothing in the codebase groups by either scam-type column.
 *
 * BUCKETED ON WHEN THE SCAM HAPPENED, NOT WHEN WE ANALYSED IT.
 *
 * The obvious field is `reddit_post_intel.processed_at`, and it is wrong.
 * It records when the classifier ran, so any backfill dumps months of old
 * posts into the current window and the panel reports a scam wave that is
 * really just us catching up. Measured while building this: the corpus
 * backfill put 1,134 rows in the trailing 28 days by processing date against
 * 847 by post date — a 34% inflation — and turned a mixed picture
 * (shopping -27%, tech support -47%) into thirteen categories all rising.
 *
 * So the Reddit stream buckets on `feed_items.source_created_at`, the post's
 * own date on Reddit, which is never null across all 4,300 rows.
 * `scam_reports.created_at` needs no equivalent: a report is submitted when
 * the person submits it, so its own timestamp already is the event time.
 *
 * WINDOW: 28 days against the prior 28, not the page's usual 7.
 *
 * The classifier sees roughly 40 posts a day, so a 7-day window puts sextortion
 * at about 7 reports. Week-over-week on 7 reports is noise wearing a
 * percentage sign. 28 days is the shortest window where the smaller categories
 * carry enough volume for a movement to mean anything, and it aligns with the
 * cadence the signal actually moves at.
 */
import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import {
  canonicalScamTypeLabel,
  toCanonicalScamType,
  type CanonicalScamType,
} from "@askarthur/types/scam-taxonomy";

/**
 * Below this combined volume a percentage is not worth reading: 1 -> 2 is
 * +100% and means nothing. Such rows are still shown — hiding a category is
 * how a rising one stays invisible — but flagged so nobody quotes the number.
 */
const MIN_VOLUME_FOR_SIGNAL = 10;

export const SCAM_TYPE_WINDOW_DAYS = 28;

export interface ScamTypeMovement {
  type: CanonicalScamType;
  label: string;
  recent: number;
  prior: number;
  /** Percent change, or null when the prior window was empty. */
  deltaPct: number | null;
  /** False when the volume is too low for the percentage to mean anything. */
  readable: boolean;
}

export interface DatedScamType {
  rawType: string | null;
  at: string;
}

/**
 * Pure. The windowing and the mapping are the part worth testing, and a
 * Server Component is the hardest place to test anything — so they live here
 * and the Supabase read stays a thin adapter below.
 */
export function computeScamTypeMovement(
  rows: DatedScamType[],
  now: Date,
  windowDays = SCAM_TYPE_WINDOW_DAYS,
): ScamTypeMovement[] {
  const ms = windowDays * 86_400_000;
  const recentFrom = now.getTime() - ms;
  const priorFrom = now.getTime() - 2 * ms;

  const recent = new Map<CanonicalScamType, number>();
  const prior = new Map<CanonicalScamType, number>();

  for (const r of rows) {
    // null means "not a scam type" — `informational` and `none` are explicit
    // judgements that a post is not a scam, and counting them would inflate
    // every total. An unmapped value is also null, and the taxonomy drift test
    // is what stops that hiding a new label.
    const type = toCanonicalScamType(r.rawType);
    if (!type) continue;

    const t = new Date(r.at).getTime();
    if (Number.isNaN(t)) continue;

    if (t >= recentFrom) recent.set(type, (recent.get(type) ?? 0) + 1);
    else if (t >= priorFrom) prior.set(type, (prior.get(type) ?? 0) + 1);
  }

  const types = new Set([...recent.keys(), ...prior.keys()]);
  return [...types]
    .map((type) => {
      const r = recent.get(type) ?? 0;
      const p = prior.get(type) ?? 0;
      return {
        type,
        label: canonicalScamTypeLabel(type),
        recent: r,
        prior: p,
        deltaPct: p === 0 ? null : Math.round(((r - p) / p) * 100),
        readable: r + p >= MIN_VOLUME_FOR_SIGNAL,
      };
    })
    .sort((a, b) => {
      // Movement first, volume second. A type going 18 -> 26 matters more than
      // `other` sitting flat at 170, and sorting by volume would bury it.
      // Unreadable rows sink so a 1 -> 3 cannot top the list.
      if (a.readable !== b.readable) return a.readable ? -1 : 1;
      const av = a.deltaPct ?? Number.POSITIVE_INFINITY;
      const bv = b.deltaPct ?? Number.POSITIVE_INFINITY;
      if (av !== bv) return bv - av;
      return b.recent - a.recent;
    });
}

export interface ScamTypeTrend {
  movements: ScamTypeMovement[];
  /** Rows read per stream, so an empty panel can be told from a failed read. */
  redditRows: number;
  reportRows: number;
  error: string | null;
}

/** The Supabase adapter. Both streams, both windows, one canonical vocabulary. */
export async function getScamTypeTrend(
  now = new Date(),
): Promise<ScamTypeTrend> {
  const empty: ScamTypeTrend = {
    movements: [],
    redditRows: 0,
    reportRows: 0,
    error: null,
  };
  const supabase = createServiceClient();
  if (!supabase) return { ...empty, error: "no service client" };

  const sinceIso = new Date(
    now.getTime() - 2 * SCAM_TYPE_WINDOW_DAYS * 86_400_000,
  ).toISOString();

  // Paginated, not `.limit()`. 56 days of Reddit intel is ~2,300 rows against
  // PostgREST's hard 1,000-row cap, and a truncated read here would not error
  // — it would quietly under-count the older window and make everything look
  // like it was growing.
  const [reddit, reports] = await Promise.all([
    fetchAllRows<{
      intent_label: string | null;
      // PostgREST types a to-one embed as an array but returns an object at
      // runtime. Typed as the union and normalised below rather than cast, so
      // a future PostgREST change surfaces as an empty panel, not a crash.
      feed_items:
        | { source_created_at: string }
        | { source_created_at: string }[]
        | null;
    }>(
      (from, to) =>
        supabase
          .from("reddit_post_intel")
          // !inner so the filter on the embedded date actually restricts the
          // parent rows rather than merely nulling the embed.
          .select("intent_label, feed_items!inner(source_created_at)")
          .gte("feed_items.source_created_at", sinceIso)
          .order("id", { ascending: true })
          .range(from, to),
      { maxRows: 100_000 },
    ),
    fetchAllRows<{ scam_type: string | null; created_at: string }>(
      (from, to) =>
        supabase
          .from("scam_reports")
          .select("scam_type, created_at")
          .gte("created_at", sinceIso)
          .order("id", { ascending: true })
          .range(from, to),
      { maxRows: 100_000 },
    ),
  ]);

  const error = reddit.error?.message ?? reports.error?.message ?? null;
  if (error) return { ...empty, error };

  const rows: DatedScamType[] = [
    ...reddit.rows
      .map((r) => {
        const fi = Array.isArray(r.feed_items) ? r.feed_items[0] : r.feed_items;
        return fi?.source_created_at
          ? { rawType: r.intent_label, at: fi.source_created_at }
          : null;
      })
      .filter((r): r is DatedScamType => r !== null),
    ...reports.rows.map((r) => ({ rawType: r.scam_type, at: r.created_at })),
  ];

  return {
    movements: computeScamTypeMovement(rows, now),
    redditRows: reddit.rows.length,
    reportRows: reports.rows.length,
    error: null,
  };
}
