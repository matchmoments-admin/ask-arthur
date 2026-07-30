import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { readBoolEnv } from "@askarthur/utils/env";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { alertAndRecord, recordNoAlertNeeded } from "@/lib/alerting/deliveryLog";
import {
  classifyFeedHealth,
  type FeedHealthRow,
  type FeedProblem,
  type FeedProblemKind,
} from "@/lib/feedHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily admin health digest.
 *
 * Schedule: 0 22 * * * UTC = 08:00 AEST (one ping/day, intentional).
 * Auth: Bearer CRON_SECRET (Vercel-Cron auto-attached).
 *
 * Three checks, all read-only SQL:
 *   1. Error rows in cost_telemetry (feature LIKE '%error%') in last 24h
 *   2. Stale feeds in feed_ingestion_log per per-feed threshold
 *   3. Cost summary (informational only)
 *
 * Silence-on-perfect-day is deliberate — silence on Telegram = success,
 * ping = action. Vercel's cron dashboard is the meta-monitor for the cron
 * itself; if THIS function stops firing, that's a Vercel-level alert.
 */

// Roster, per-feed expectations and mute state all live in the database
// (feed_sources → feed_health view, migration-v261). Classification lives in
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMessage(
  errors: ErrorRow[],
  problems: FeedProblem[],
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
  lines.push(
    `🔗 <a href="https://askarthur.au/admin/health">Full status</a>`,
  );
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
  // Reads the feed_health view (migration-v261), which is one row per ENABLED
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

  // ── Decision: alert or stay silent ────────────────────────────────────
  const issues = errors.length > 0 || problems.length > 0;
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
      cost_usd: cost.cost_usd,
    });
    return NextResponse.json({
      healthy: true,
      errors_24h: 0,
      feeds_checked: rows.length,
      feeds_muted: mutedCount,
      problems: 0,
      cost,
    });
  }

  const message = buildMessage(errors, problems, cost, mutedCount);

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
      feeds_checked: rows.length,
      feeds_muted: mutedCount,
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
    feeds_checked: rows.length,
    feeds_muted: mutedCount,
    cost,
  });
}
