import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  ALERTERS,
  alertAndRecord,
  type Alerter,
} from "@/lib/alerting/deliveryLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Weekly synthetic alerting canary — Tier 2 item 5 of the #903 schedule,
 * closing the 2026-07-29 review's "you cannot distinguish 'nothing has gone
 * wrong' from 'nothing is being reported'" finding.
 *
 * Two jobs, one firing (Monday 08:00 UTC = 6pm AEST):
 *
 * 1. PROVE THE CHANNEL. Send a Telegram message UNCONDITIONALLY — the
 *    founder seeing this every Monday is the human-verifiable proof that the
 *    alert pipe itself works. Per the standing lesson (memory:
 *    proof-of-life-must-not-be-conditional), the heartbeat never varies its
 *    existence with the news it carries — only its content.
 * 2. LIVENESS-SWEEP THE FLEET. Every alerter writes one alert_delivery_log
 *    row per firing (the v263 rule), so a per-alerter row count over the
 *    last 8 days against a conservative floor detects a dead alerter — the
 *    failure class where a cron silently stops executing and its silence
 *    reads as health.
 *
 * Floors are deliberately ~expected/8 (see ALERTERS doc comment for expected
 * weekly firings): loose enough to survive a deploy gap or a slow week,
 * tight enough that a genuinely dead alerter cannot pass. The canary
 * excludes itself from the sweep (its own liveness is proven by arriving).
 *
 * If the Telegram send itself fails, this route returns 500 so the Vercel
 * cron dashboard shows a failed run — the one place left to look when the
 * alert channel is what died.
 */

/** Conservative minimum alert_delivery_log rows per alerter, last 8 days. */
const LIVENESS_FLOORS: Record<Exclude<Alerter, "alerting-canary">, number> = {
  "pg-stuck-query-watchdog": 250,
  "axiom-fleet-watch": 80,
  "scraper-brake-alert": 80,
  "cost-daily-check": 4,
  "health-digest": 2,
  "feedback-digest": 2,
  "clone-lead-digest": 1,
  "cost-weekly-digest": 1,
};

export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();

  // The sweep is best-effort: a DB outage must not stop the heartbeat —
  // an arriving canary that says "sweep failed" still proves the channel.
  let counts: Record<string, number> | null = null;
  if (supabase) {
    const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    // Per-alerter EXACT counts, one head query each. The old shape fetched
    // rows with `.limit(10_000)` and tallied them — but PostgREST caps the
    // response at 1000, so once the 8-day window held more than that the
    // tallies were arbitrary. That inverts the control this cron exists to be:
    // a capped count can drop an alerter below its floor and page a false
    // "silent alerter", or spread the cap across alerters and mask a real one.
    // `count: "exact", head: true` is not row-capped.
    counts = {};
    for (const alerter of Object.keys(LIVENESS_FLOORS)) {
      const { count, error } = await supabase
        .from("alert_delivery_log")
        .select("id", { count: "exact", head: true })
        .eq("alerter", alerter)
        .gte("fired_at", since);
      // A head-count failure returns count:null with error:null (no body to
      // parse), so the null check is the load-bearing one.
      if (error || count === null) {
        logger.error("alerting-canary: liveness query failed", {
          alerter,
          error:
            error?.message ?? "count was null (head query returned no count)",
        });
        counts = null;
        break;
      }
      counts[alerter] = count;
    }
  }

  const silent: string[] = [];
  const summary: string[] = [];
  if (counts) {
    for (const [alerter, floor] of Object.entries(LIVENESS_FLOORS)) {
      const n = counts[alerter] ?? 0;
      summary.push(`${alerter}: ${n}`);
      if (n < floor) silent.push(`${alerter} (${n} rows, floor ${floor})`);
    }
  }

  const headline = !counts
    ? "⚠️ Canary alive but the liveness sweep FAILED — check alert_delivery_log connectivity."
    : silent.length === 0
      ? `✅ All ${Object.keys(LIVENESS_FLOORS).length} alerters alive.`
      : `🚨 ${silent.length} alerter(s) below liveness floor:\n${silent.map((s) => `  • ${s}`).join("\n")}`;

  const result = await alertAndRecord({
    alerter: "alerting-canary",
    text: [
      `🕊 <b>Weekly alerting canary</b>`,
      ``,
      headline,
      ``,
      counts ? `8-day row counts — ${summary.join(" · ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: { silent, sweepOk: counts !== null },
  });

  if (!result.ok) {
    // The channel itself is down. 500 makes the Vercel cron run visibly
    // fail — the last observable signal when Telegram delivery is broken.
    return NextResponse.json(
      { error: "canary_send_failed", reason: result.reason },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    silent,
    sweepOk: counts !== null,
  });
}
