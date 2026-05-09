import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALERT_MINUTES = 10;
const TERMINATE_MINUTES = 60;

/**
 * Every 5 min (vercel.json: "*\/5 * * * *"). Lists any active Postgres
 * backend whose current query has run >= ALERT_MINUTES, excluding routine
 * maintenance. Pages admin Telegram on hits. If
 * PG_WATCHDOG_AUTO_TERMINATE=true, also pg_terminate_backend() any backend
 * past TERMINATE_MINUTES.
 *
 * Born from incident 2026-05-09: a single ACNC-sweep backend hung for
 * 20 hours holding row locks on acnc_charities, which cascaded into a
 * site-wide 504. Detection was manual ("the homepage is broken") rather
 * than automated. This watchdog closes that gap to ~5 min.
 *
 * Auto-terminate is OFF by default — for the first deploy we want to
 * observe alerts for a week before letting the watchdog kill a real
 * backend. Flip PG_WATCHDOG_AUTO_TERMINATE on Vercel after that.
 */
type StuckBackend = {
  pid: number;
  minutes: number;
  application_name: string | null;
  query_preview: string | null;
};

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

  const { data, error } = await supabase.rpc("list_long_running_queries", {
    min_minutes: ALERT_MINUTES,
  });

  if (error) {
    logger.error("pg-stuck-query-watchdog: list RPC failed", {
      error: error.message,
    });
    return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
  }

  const stuck = (data ?? []) as StuckBackend[];
  if (stuck.length === 0) {
    return NextResponse.json({ ok: true, stuck: 0 });
  }

  const lines = stuck.map((row) => {
    const mins = Math.round(row.minutes);
    const app = row.application_name ?? "?";
    const preview = (row.query_preview ?? "").replace(/\s+/g, " ").trim();
    return `• <code>PID ${row.pid}</code> — ${mins}min — ${app}\n  <code>${escapeHtml(preview)}</code>`;
  });

  await sendAdminTelegramMessage(
    `<b>⚠️ Postgres stuck queries (≥${ALERT_MINUTES}min)</b>\n\n${lines.join("\n\n")}`,
    { parseMode: "HTML" },
  );

  const autoTerminate = process.env.PG_WATCHDOG_AUTO_TERMINATE === "true";
  const terminated: number[] = [];
  if (autoTerminate) {
    for (const row of stuck) {
      if (row.minutes < TERMINATE_MINUTES) continue;
      const { error: termErr } = await supabase.rpc("terminate_stuck_query", {
        target_pid: row.pid,
      });
      if (termErr) {
        logger.error("pg-stuck-query-watchdog: terminate failed", {
          pid: row.pid,
          error: termErr.message,
        });
        continue;
      }
      logger.warn(
        `pg-stuck-query-watchdog: auto-terminated PID ${row.pid} (${Math.round(
          row.minutes,
        )}min)`,
      );
      terminated.push(row.pid);
    }
  }

  return NextResponse.json({
    ok: true,
    stuck: stuck.length,
    terminated,
    autoTerminate,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
