import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Window we sweep for fresh `partial:backoff_active` rows. Slightly wider
// than the cron cadence (15 min) so we don't drop a brake-activation that
// landed at the very tail of the prior window.
const LOOKBACK_MINUTES = 20;
const BACKOFF_PREFIX = "backoff_active:";

type LogRow = {
  feed_name: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

/**
 * Every 15 min (vercel.json: "*\/15 * * * *"). Looks for scrapers whose
 * most recent feed_ingestion_log row is a freshly-written
 * `partial:backoff_active` AND whose row immediately before it is NOT a
 * backoff partial — i.e. they just transitioned from "running" to
 * "circuit-breaker on". Pages the admin Telegram chat with the list.
 *
 * We page only on transitions, not on every cooldown skip, so if a
 * scraper stays broken for 5 days the operator gets one alert at the
 * start, not 480.
 */
export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const { data: recent, error: recentErr } = await supabase
    .from("feed_ingestion_log")
    .select("feed_name, status, error_message, created_at")
    .eq("status", "partial")
    .like("error_message", `${BACKOFF_PREFIX}%`)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (recentErr) {
    logger.error("scraper-brake-alert: recent-rows query failed", {
      error: recentErr.message,
    });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const recentRows = (recent ?? []) as LogRow[];
  if (recentRows.length === 0) {
    return NextResponse.json({ ok: true, alerted: 0 });
  }

  // For each unique feed_name in the recent backoff partials, look at the
  // row immediately preceding the most recent one. If that prior row is
  // ALSO a backoff partial, we've already paged on this activation —
  // skip. Otherwise this is a fresh transition; page once.
  const seen = new Set<string>();
  const transitions: LogRow[] = [];

  for (const row of recentRows) {
    if (seen.has(row.feed_name)) continue;
    seen.add(row.feed_name);

    const { data: prev } = await supabase
      .from("feed_ingestion_log")
      .select("status, error_message, created_at")
      .eq("feed_name", row.feed_name)
      .lt("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevWasBackoff =
      prev !== null &&
      prev.status === "partial" &&
      typeof prev.error_message === "string" &&
      prev.error_message.startsWith(BACKOFF_PREFIX);

    if (!prevWasBackoff) {
      transitions.push(row);
    }
  }

  if (transitions.length === 0) {
    return NextResponse.json({ ok: true, alerted: 0, scanned: recentRows.length });
  }

  const lines = transitions.map((row) => {
    const reason = (row.error_message ?? "").slice(BACKOFF_PREFIX.length).trim();
    return `• <code>${escapeHtml(row.feed_name)}</code> — ${escapeHtml(reason)}`;
  });

  await sendAdminTelegramMessage(
    `<b>🚧 Scraper circuit breaker tripped</b>\n\n${lines.join(
      "\n",
    )}\n\nThe affected scrapers will skip every cron firing for 24h. Manual probe: <code>gh workflow run scrape-feeds.yml -f feed=&lt;name&gt;</code>`,
    { parseMode: "HTML" },
  );

  logger.warn(
    `scraper-brake-alert: paged on ${transitions.length} new activation(s)`,
    { feeds: transitions.map((r) => r.feed_name) },
  );

  return NextResponse.json({
    ok: true,
    alerted: transitions.length,
    feeds: transitions.map((r) => r.feed_name),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
