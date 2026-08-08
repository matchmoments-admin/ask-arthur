// Feed control surface for /admin/health (#952).
//
// Why this exists: muting, unmuting and probing a threat feed were SQL +
// `gh workflow run` jobs, so a dark feed stayed dark until someone happened to
// look. The state that made the case: `acsc` sits at enabled=false with NO
// muted_until — it is not a lapsing mute, it is simply off, indefinitely, with
// nothing surfacing it. `phishstats` is muted until 2026-09-03. Both facts were
// invisible from the console.
//
// Deliberately EXTENDS /admin/health rather than adding a page: that surface
// already reads the feed_health view (v264) and already owns "is the fleet
// healthy". One home for feeds; controls live where the health signal is.

import "server-only";

import type { createServiceClient } from "@askarthur/supabase/server";

type Svc = ReturnType<typeof createServiceClient>;

/** Feed slugs the scrape-feeds workflow accepts as a `feed` dispatch input.
 *  Mirrors the `choice` options in .github/workflows/scrape-feeds.yml — a feed
 *  absent here has no dispatch target and its probe button is hidden rather
 *  than dispatching a value the workflow would reject. Keep the two in sync;
 *  feedControlsDrift.test.ts fails the build if they diverge. */
export const PROBEABLE_FEEDS = new Set([
  "scamwatch_alerts",
  "acsc_alerts",
  "asic_investor_alerts",
  "probe_acsc",
  "urlhaus",
  "openphish",
  "phishtank",
  "phishstats",
  "phishing_database",
  "phishing_army",
  "feodo",
  "ipsum",
  "spamhaus",
  "abuseipdb",
  "crtsh",
  "reddit",
  "acnc_register",
  "pfra_members",
  "austrac",
]);

/** feed_health names don't always equal the workflow's dispatch value. Only
 *  the genuinely different ones are listed; everything else maps to itself. */
const DISPATCH_ALIASES: Record<string, string> = {
  acsc: "acsc_alerts",
  asic_investor: "asic_investor_alerts",
  scamwatch_alert: "scamwatch_alerts",
};

/** The dispatch input for a feed, or null when the workflow has no target. */
export function dispatchTargetFor(feedName: string): string | null {
  const candidate = DISPATCH_ALIASES[feedName] ?? feedName;
  return PROBEABLE_FEEDS.has(candidate) ? candidate : null;
}

export interface FeedControlRow {
  slug: string;
  name: string | null;
  /** false = switched off entirely; it will NOT come back on its own. */
  enabled: boolean;
  mutedUntil: string | null;
  mutedReason: string | null;
  hoursSinceSuccess: number | null;
  newRows7d: number;
  runs7d: number;
  /** Derived: what an operator should read at a glance. */
  state: "ok" | "stale" | "muted" | "disabled" | "never-run";
  /** Dispatch input for a probe, or null when the workflow can't run it. */
  dispatchTarget: string | null;
}

const STALE_HOURS = 36;

export function deriveState(row: {
  enabled: boolean;
  mutedUntil: string | null;
  hoursSinceSuccess: number | null;
}): FeedControlRow["state"] {
  // Order matters: "disabled" outranks everything because it is the state that
  // never resolves itself, and it is the one the console previously hid.
  if (!row.enabled) return "disabled";
  if (row.mutedUntil && new Date(row.mutedUntil).getTime() > Date.now()) return "muted";
  if (row.hoursSinceSuccess == null) return "never-run";
  return row.hoursSinceSuccess <= STALE_HOURS ? "ok" : "stale";
}

/**
 * Every feed with its health + control state, ordered worst-first so the
 * problems are at the top of the panel rather than alphabetically buried.
 * Errors are surfaced (not coalesced to an empty list) — a failed query must
 * never render as "no feeds have problems".
 */
export async function getFeedControlRows(
  svc: Svc,
  errors?: string[],
): Promise<FeedControlRow[]> {
  if (!svc) return [];

  const [healthRes, sourcesRes] = await Promise.all([
    svc
      .from("feed_health")
      .select("feed_name, is_muted, muted_until, muted_reason, hours_since_success, new_rows_7d, runs_7d"),
    svc.from("feed_sources").select("slug, name, enabled, muted_until, muted_reason"),
  ]);

  if (healthRes.error) errors?.push("feed health");
  if (sourcesRes.error) errors?.push("feed sources");

  const sources = new Map(
    (sourcesRes.data ?? []).map((s) => [
      s.slug as string,
      s as { slug: string; name: string | null; enabled: boolean; muted_until: string | null; muted_reason: string | null },
    ]),
  );

  const rows: FeedControlRow[] = (healthRes.data ?? []).map((h) => {
    const slug = h.feed_name as string;
    const src = sources.get(slug);
    const enabled = src?.enabled ?? true;
    const mutedUntil = (src?.muted_until ?? (h.muted_until as string | null)) ?? null;
    const hoursSinceSuccess =
      h.hours_since_success == null ? null : Number(h.hours_since_success);
    return {
      slug,
      name: src?.name ?? null,
      enabled,
      mutedUntil,
      mutedReason: src?.muted_reason ?? (h.muted_reason as string | null) ?? null,
      hoursSinceSuccess,
      newRows7d: Number(h.new_rows_7d ?? 0),
      runs7d: Number(h.runs_7d ?? 0),
      state: deriveState({ enabled, mutedUntil, hoursSinceSuccess }),
      dispatchTarget: dispatchTargetFor(slug),
    };
  });

  // Feeds present in feed_sources but with no health row at all — the most
  // invisible failure of the lot, so they are included rather than dropped.
  for (const [slug, src] of sources) {
    if (rows.some((r) => r.slug === slug)) continue;
    if (!src.enabled || src.muted_until) {
      rows.push({
        slug,
        name: src.name,
        enabled: src.enabled,
        mutedUntil: src.muted_until,
        mutedReason: src.muted_reason,
        hoursSinceSuccess: null,
        newRows7d: 0,
        runs7d: 0,
        state: deriveState({ enabled: src.enabled, mutedUntil: src.muted_until, hoursSinceSuccess: null }),
        dispatchTarget: dispatchTargetFor(slug),
      });
    }
  }

  const rank: Record<FeedControlRow["state"], number> = {
    disabled: 0,
    stale: 1,
    "never-run": 2,
    muted: 3,
    ok: 4,
  };
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || a.slug.localeCompare(b.slug));
}
