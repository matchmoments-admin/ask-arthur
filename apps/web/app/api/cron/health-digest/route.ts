import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { readBoolEnv } from "@askarthur/utils/env";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  alertAndRecord,
  recordNoAlertNeeded,
} from "@/lib/alerting/deliveryLog";
import {
  classifyFeedHealth,
  type FeedHealthRow,
  type FeedProblem,
  type FeedProblemKind,
} from "@/lib/feedHealth";
import { LANE_BRAKES } from "@askarthur/scam-engine/lane-outcome";
import {
  classifyLaneHealth,
  LANES_CHECKED,
  laneFetchPlan,
  type LaneCostRow,
  type LaneProblem,
  type LaneProblemKind,
} from "@/lib/laneHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily admin health digest.
 *
 * Schedule: 0 22 * * * UTC = 08:00 AEST (one ping/day, intentional).
 * Auth: Bearer CRON_SECRET (Vercel-Cron auto-attached).
 *
 * Four checks, all read-only SQL:
 *   1. Error rows in cost_telemetry (feature LIKE '%error%') in last 24h
 *   2. Stale feeds in feed_ingestion_log per per-feed threshold
 *   3. Cost summary (informational only)
 *   4. Clone-watch lanes that ran, did nothing, and reported ok:true — the
 *      silent-zero detector (#1145). Roster + predicates in @/lib/laneHealth;
 *      this route only fetches the lanes' recent cost rows and renders.
 *
 * Silence-on-perfect-day is deliberate — silence on Telegram = success,
 * ping = action. Vercel's cron dashboard is the meta-monitor for the cron
 * itself; if THIS function stops firing, that's a Vercel-level alert.
 */

// Roster, per-feed expectations and mute state all live in the database
// (feed_sources → feed_health view, migration-v264). Classification lives in
// @/lib/feedHealth so the four verdicts are testable without a DB. This file
// deliberately carries NO hardcoded feed list — the one it used to have
// (KNOWN_DORMANT_FEEDS) muted 7 actively-producing feeds for months.

interface ErrorRow {
  feature: string;
  operation: string;
  hits: number;
  last_seen: string;
}

interface CostSummary {
  cost_usd: number;
  events: number;
}

/**
 * Display order for lane problems, worst first. Type-checked both ways: every
 * entry is a LaneProblemKind (`satisfies`), and every LaneProblemKind appears
 * (`_everyKindListed` fails to compile if a new kind is added to the union but
 * not here — a missing kind would otherwise never be rendered).
 */
const LANE_PROBLEM_ORDER = [
  "brake_unknown",
  "quota_exhausted",
  "absent",
  "braked",
  "silent_zero",
] as const satisfies readonly LaneProblemKind[];
const _everyKindListed: Exclude<
  LaneProblemKind,
  (typeof LANE_PROBLEM_ORDER)[number]
> extends never
  ? true
  : never = true;
void _everyKindListed;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildMessage(
  errors: ErrorRow[],
  problems: FeedProblem[],
  laneProblems: LaneProblem[],
  cost: CostSummary,
  mutedCount: number,
): string {
  const dateStr = new Date().toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const lines: string[] = [
    "🩺 <b>Ask Arthur — Daily Health Digest</b>",
    escapeHtml(dateStr),
    "",
  ];

  if (errors.length > 0) {
    lines.push("❌ <b>Errors (last 24h):</b>");
    for (const e of errors) {
      lines.push(
        `  • ${escapeHtml(e.feature)} / ${escapeHtml(e.operation)} — ${e.hits} hit${e.hits === 1 ? "" : "s"}`,
      );
    }
    lines.push("");
  }

  if (problems.length > 0) {
    const LABEL: Record<FeedProblemKind, string> = {
      absent: "🚫 <b>Not running at all:</b>",
      never_succeeds: "💀 <b>Never succeeded:</b>",
      stale: "⏱️ <b>Stale:</b>",
      silent_success: "🕳️ <b>Succeeding but producing nothing:</b>",
    };
    // Grouped by kind, worst first — "not running" and "never succeeded" are
    // categorically worse than "a bit behind" and used to be indistinguishable.
    for (const kind of [
      "absent",
      "never_succeeds",
      "stale",
      "silent_success",
    ] as FeedProblemKind[]) {
      const group = problems.filter((p) => p.kind === kind);
      if (group.length === 0) continue;
      lines.push(LABEL[kind]);
      for (const p of group) {
        lines.push(`  • ${escapeHtml(p.feed_name)} — ${escapeHtml(p.detail)}`);
      }
      lines.push("");
    }
  }

  if (laneProblems.length > 0) {
    const LANE_LABEL: Record<LaneProblemKind, string> = {
      absent:
        "🚫 <b>Clone-watch lane wrote no outcome row (not running, or skipped without logging):</b>",
      braked: "🛑 <b>Clone-watch lane braked:</b>",
      brake_unknown: "❓ <b>Clone-watch brake state unreadable:</b>",
      quota_exhausted: "⛔ <b>Clone-watch lane stopped by a vendor quota:</b>",
      silent_zero: "🕳️ <b>Clone-watch lane running but doing nothing:</b>",
    };
    for (const kind of LANE_PROBLEM_ORDER) {
      const group = laneProblems.filter((p) => p.kind === kind);
      if (group.length === 0) continue;
      lines.push(LANE_LABEL[kind]);
      for (const p of group) {
        lines.push(`  • ${escapeHtml(p.lane)} — ${escapeHtml(p.detail)}`);
      }
      lines.push("");
    }
  }

  // Muted feeds are always counted, never hidden. The suppression list this
  // replaced was invisible, which is how it drifted to muting 7 live feeds.
  if (mutedCount > 0) {
    lines.push(
      `🔇 ${mutedCount} feed${mutedCount === 1 ? "" : "s"} muted (see feed_sources.muted_until / muted_reason)`,
    );
  }

  lines.push(
    `💰 Last 24h: $${cost.cost_usd.toFixed(2)} across ${cost.events.toLocaleString()} events`,
  );
  lines.push(`🔗 <a href="https://askarthur.au/admin/health">Full status</a>`);
  return lines.join("\n");
}

export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // ── Check 1: error rows in cost_telemetry ─────────────────────────────
  const { data: errorRows, error: errorQueryError } = await supabase
    .from("cost_telemetry")
    .select("feature, operation, created_at")
    .or("feature.like.%-error,feature.like.%error%")
    .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

  if (errorQueryError) {
    logger.error("health-digest: error query failed", {
      error: errorQueryError.message,
    });
  }

  // Group in JS — supabase-js doesn't support GROUP BY directly without an RPC,
  // and at our scale (<100 error rows/day worst case) the in-process aggregate
  // is fine.
  const errorMap = new Map<string, ErrorRow>();
  for (const row of errorRows ?? []) {
    const key = `${row.feature as string}|${row.operation as string}`;
    const existing = errorMap.get(key);
    const lastSeen = row.created_at as string;
    if (existing) {
      existing.hits += 1;
      if (lastSeen > existing.last_seen) existing.last_seen = lastSeen;
    } else {
      errorMap.set(key, {
        feature: row.feature as string,
        operation: row.operation as string,
        hits: 1,
        last_seen: lastSeen,
      });
    }
  }
  const errors: ErrorRow[] = Array.from(errorMap.values()).sort(
    (a, b) => b.hits - a.hits,
  );

  // ── Check 2: feed health ──────────────────────────────────────────────
  // Reads the feed_health view (migration-v264), which is one row per ENABLED
  // feed WHETHER OR NOT IT HAS LOGGED ANYTHING. That LEFT JOIN is the whole
  // point: the previous implementation read `.limit(500)` from
  // feed_ingestion_log, which spanned 6.7 days and contained 15 of 20 feeds —
  // and the 5 missing were exactly the dead ones. A feed that stops writing
  // drops out of any query that groups by what is present, so the harder a feed
  // failed, the more certainly it was invisible.
  const { data: healthRows, error: healthError } = await supabase
    .from("feed_health")
    .select("*");

  if (healthError) {
    logger.error("health-digest: feed_health query failed", {
      error: healthError.message,
    });
  }

  const rows = (healthRows ?? []) as unknown as FeedHealthRow[];
  const { problems, mutedCount } = classifyFeedHealth(rows);

  const now = Date.now();

  // ── Check 3: cost summary (informational) ─────────────────────────────
  const { data: costRows, error: costError } = await supabase
    .from("cost_telemetry")
    .select("estimated_cost_usd")
    .gte("created_at", new Date(now - 24 * 3600 * 1000).toISOString());

  if (costError) {
    logger.error("health-digest: cost query failed", {
      error: costError.message,
    });
  }

  const cost: CostSummary = {
    cost_usd: (costRows ?? []).reduce(
      (sum, r) => sum + Number(r.estimated_cost_usd ?? 0),
      0,
    ),
    events: (costRows ?? []).length,
  };

  // ── Check 4: clone-watch silent-zero lanes (#1145) ────────────────────
  // One query per fetch-plan window (laneFetchPlan, derived from each lane's
  // expectEvery): 72 h for frequent lanes, ~33 days for the weekly/monthly
  // ones — a single 72 h window paged those "absent" most days. Long-cadence
  // features write a handful of rows a month, so the second query is tiny;
  // 1000 is PostgREST's hard cap (rowCap.test.ts). Brake state comes from
  // feature_brakes, not from the rows: a cleared brake otherwise reads as
  // braked until the lane's next run overwrites the row.
  const lanePlan = laneFetchPlan();
  const [laneResults, brakeRes] = await Promise.all([
    Promise.all(
      lanePlan.map((g) =>
        supabase
          .from("cost_telemetry")
          .select("feature, operation, created_at, units, metadata")
          .in("feature", g.features)
          .gte("created_at", new Date(now - g.windowMs).toISOString())
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
    ),
    supabase
      .from("feature_brakes")
      .select("feature, paused_until")
      .in("feature", [...LANE_BRAKES]),
  ]);
  const laneRes = {
    error: laneResults.find((r) => r.error)?.error ?? null,
    data: laneResults.flatMap((r) => r.data ?? []),
  };

  if (laneRes.error) {
    logger.error("health-digest: lane query failed", {
      error: laneRes.error.message,
    });
  }
  if (brakeRes.error) {
    // Reported as its own lane problem (brake_unknown), not collapsed into
    // "not braked" — that silent default was the one brake read in the repo
    // that bypassed brakeState's three-valued rule (review 2026-09-24).
    logger.error("health-digest: brake query failed", {
      error: brakeRes.error.message,
    });
  }
  let brakes: Record<string, string | null> | "unreadable" = "unreadable";
  if (!brakeRes.error) {
    brakes = {};
    for (const b of (brakeRes.data ?? []) as {
      feature: string;
      paused_until: string | null;
    }[]) {
      brakes[b.feature] = b.paused_until;
    }
  }
  // A failed lane query must not read as "all lanes healthy": with no rows
  // every roster lane classifies as absent, which is the loud outcome.
  const laneProblems = classifyLaneHealth(
    (laneRes.data ?? []) as unknown as LaneCostRow[],
    { now, brakes },
  );

  // ── Decision: alert or stay silent ────────────────────────────────────
  const issues =
    errors.length > 0 || problems.length > 0 || laneProblems.length > 0;
  if (!issues) {
    logger.info("health-digest: all clear", {
      cost_usd: cost.cost_usd,
      events: cost.events,
    });
    // Record the all-clear. This row is load-bearing: on 2026-07-29 this exact
    // branch reported healthy while acnc_register was 86 days stale, and with no
    // row there was no way to tell a true all-clear from a dead cron. The
    // metadata records WHAT was checked so a wrong all-clear stays diagnosable.
    await recordNoAlertNeeded("health-digest", {
      errors_24h: 0,
      feeds_checked: rows.length,
      feeds_muted: mutedCount,
      lanes_checked: LANES_CHECKED,
      cost_usd: cost.cost_usd,
    });
    return NextResponse.json({
      healthy: true,
      errors_24h: 0,
      feeds_checked: rows.length,
      feeds_muted: mutedCount,
      lanes_checked: LANES_CHECKED,
      problems: 0,
      cost,
    });
  }

  const message = buildMessage(
    errors,
    problems,
    laneProblems,
    cost,
    mutedCount,
  );

  // Telegram send is gated by FF_LEGACY_DIGEST_TELEGRAM. The signal now rides
  // in the consolidated 7am founder brief (Claude Code Routine "Daily Founder
  // Briefing"). Flip to "true" to restore the legacy daily ping during an
  // incident or while the new brief is being trusted.
  const legacyTelegramEnabled = readBoolEnv("FF_LEGACY_DIGEST_TELEGRAM");

  await alertAndRecord({
    alerter: "health-digest",
    text: message,
    enabled: legacyTelegramEnabled,
    metadata: {
      error_count: errors.reduce((s, e) => s + e.hits, 0),
      problem_count: problems.length,
      problems: problems.map((p) => `${p.kind}:${p.feed_name}`),
      lane_problem_count: laneProblems.length,
      lane_problems: laneProblems.map((p) => `${p.kind}:${p.lane}`),
      feeds_checked: rows.length,
      feeds_muted: mutedCount,
      lanes_checked: LANES_CHECKED,
      cost_usd: cost.cost_usd,
      mutedBy: legacyTelegramEnabled ? null : "FF_LEGACY_DIGEST_TELEGRAM",
    },
  });

  if (legacyTelegramEnabled) {
    logger.warn("health-digest: issues detected, admin notified", {
      error_count: errors.reduce((s, e) => s + e.hits, 0),
      problem_count: problems.length,
      cost_usd: cost.cost_usd,
    });
  } else {
    logger.warn(
      "health-digest: issues detected; telegram muted (FF_LEGACY_DIGEST_TELEGRAM off), rolled into morning brief",
      {
        error_count: errors.reduce((s, e) => s + e.hits, 0),
        problem_count: problems.length,
        cost_usd: cost.cost_usd,
      },
    );
  }

  return NextResponse.json({
    alerted: legacyTelegramEnabled,
    muted: !legacyTelegramEnabled,
    errors,
    problems,
    lane_problems: laneProblems,
    feeds_checked: rows.length,
    feeds_muted: mutedCount,
    lanes_checked: LANES_CHECKED,
    cost,
  });
}
