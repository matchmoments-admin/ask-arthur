import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

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

// Per-feed staleness thresholds in hours. Anything outside this map falls
// back to DEFAULT_STALENESS_HOURS. Tightened thresholds for hot feeds so
// a 12h regression on Scamwatch (which runs 3-hourly) doesn't slip past
// the wider 36h default.
const STALENESS_THRESHOLD_HOURS: Record<string, number> = {
  reddit: 36,
  scamwatch_alert: 12,
  // ACSC currently dark from GH-Actions IPs (Akamai tarpit, BACKLOG.md).
  // Once PR #147's Vercel ingest is verified green, revert to 12h.
  acsc: 999,
  asic_investor: 36,
  acnc_register: 36,
  pfra_members: 36,
  reddit_intel: 30,
};

const DEFAULT_STALENESS_HOURS = 36;

// Feeds we know are dormant by choice (manual-only, low-priority — see
// BACKLOG.md → Pipeline / Scrapers). Excluded from staleness alerts so
// the daily digest stays signal, not noise.
const KNOWN_DORMANT_FEEDS = new Set([
  "phishing_army",
  "openphish",
  "crtsh",
  "phishtank",
  "ipsum",
  "feodo",
  "phishing_database",
  "phishstats",
  "threatfox",
  "spamhaus",
  "abuseipdb",
  "cryptoscamdb",
]);

interface ErrorRow {
  feature: string;
  operation: string;
  hits: number;
  last_seen: string;
}

interface StaleFeed {
  feed_name: string;
  last_run: string;
  hours_stale: number;
  threshold_hours: number;
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
  stale: StaleFeed[],
  cost: CostSummary,
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

  if (stale.length > 0) {
    lines.push("⏱️ <b>Stale feeds:</b>");
    for (const s of stale) {
      lines.push(
        `  • ${escapeHtml(s.feed_name)} — ${s.hours_stale.toFixed(1)}h since last run (threshold ${s.threshold_hours}h)`,
      );
    }
    lines.push("");
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
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

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

  // ── Check 2: stale feeds ──────────────────────────────────────────────
  // Pull the latest run per feed. supabase-js doesn't expose
  // SELECT DISTINCT ON, so fetch ordered + dedupe in TS.
  const { data: feedRows, error: feedError } = await supabase
    .from("feed_ingestion_log")
    .select("feed_name, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (feedError) {
    logger.error("health-digest: feed query failed", {
      error: feedError.message,
    });
  }

  const lastRunByFeed = new Map<string, string>();
  for (const row of feedRows ?? []) {
    const name = row.feed_name as string;
    if (!lastRunByFeed.has(name)) {
      lastRunByFeed.set(name, row.created_at as string);
    }
  }

  const now = Date.now();
  const stale: StaleFeed[] = [];
  for (const [feed_name, last_run] of lastRunByFeed) {
    if (KNOWN_DORMANT_FEEDS.has(feed_name)) continue;
    const hours_stale = (now - new Date(last_run).getTime()) / 3_600_000;
    const threshold_hours =
      STALENESS_THRESHOLD_HOURS[feed_name] ?? DEFAULT_STALENESS_HOURS;
    if (hours_stale > threshold_hours) {
      stale.push({ feed_name, last_run, hours_stale, threshold_hours });
    }
  }
  stale.sort((a, b) => b.hours_stale - a.hours_stale);

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
  const issues = errors.length > 0 || stale.length > 0;
  if (!issues) {
    logger.info("health-digest: all clear", {
      cost_usd: cost.cost_usd,
      events: cost.events,
    });
    return NextResponse.json({
      healthy: true,
      errors_24h: 0,
      stale_feeds: 0,
      cost,
    });
  }

  const message = buildMessage(errors, stale, cost);
  await sendAdminTelegramMessage(message);

  logger.warn("health-digest: issues detected, admin notified", {
    error_count: errors.reduce((s, e) => s + e.hits, 0),
    stale_count: stale.length,
    cost_usd: cost.cost_usd,
  });

  return NextResponse.json({
    alerted: true,
    errors,
    stale_feeds: stale,
    cost,
  });
}
