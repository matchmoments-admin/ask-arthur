import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import {
  buildCostDigest,
  earliestDayNeeded,
  formatCostDigest,
  thisWindowTimestamps,
  type CostRow,
} from "@/lib/cost-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sunday 22:00 UTC (= Monday 08:00 AEST) via vercel.json cron. DMs the
 * admin Telegram chat with the last two COMPLETE 7-day windows, their WoW
 * delta, the top-5 features by spend (each with its own WoW delta), the
 * biggest mover, and the priciest-per-event feature.
 *
 * The window arithmetic and rendering live in `@/lib/cost-digest` — pure and
 * unit-tested, because this route previously compared an 8-day "this week"
 * against a 7-day "last week" and so systematically under-reported cost
 * increases. See that module's header for the reproduced numbers.
 *
 * Unconditional send — every week regardless of activity, so "quiet
 * week" is information too.
 */
export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const now = new Date();

  const { data, error } = await supabase
    .from("daily_cost_summary")
    .select("day, feature, provider, event_count, total_cost_usd")
    .gte("day", earliestDayNeeded(now))
    .order("day", { ascending: false });

  if (error) {
    logger.error("cost-weekly-digest: query failed", { error: error.message });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  // Inbound-scan apology-reply count over the SAME window as the spend figures
  // (previously a rolling now-7d timestamp, which didn't line up with the day
  // buckets). Logged whenever analyzeForBot exhausts its in-route retry budget
  // (Anthropic 529 sustained past ~50s — see apps/web/app/api/inbound-scan/route.ts).
  // At friends-only pilot volume this should be 0 most weeks. A non-zero count
  // is the documented signal to promote issue #315 (durable v2 — Inngest +
  // brake + ops Telegram alerts) from ready-for-agent/p2 to grab-now.
  const window = thisWindowTimestamps(now);
  const { count: inboundScanFailuresRaw, error: failuresErr } = await supabase
    .from("cost_telemetry")
    .select("*", { count: "exact", head: true })
    .eq("feature", "inbound_scan")
    .eq("operation", "email_forward_failed")
    .gte("created_at", window.fromInclusive)
    .lt("created_at", window.toExclusive);
  if (failuresErr) {
    // Non-fatal — digest still ships without the signal line.
    logger.error("cost-weekly-digest: inbound-scan failures query failed", {
      error: failuresErr.message,
    });
  }
  const inboundScanFailures = inboundScanFailuresRaw ?? 0;

  const rows: CostRow[] = (data ?? []).map((r) => ({
    day: r.day as string,
    feature: r.feature as string,
    provider: r.provider as string,
    events: Number(r.event_count),
    cost: Number(r.total_cost_usd),
  }));

  const digest = buildCostDigest(rows, now);

  await sendAdminTelegramMessage(
    formatCostDigest(digest, { inboundScanFailures }).join("\n"),
  );

  return NextResponse.json({
    weekEnding: digest.weekEnding,
    windowDays: digest.windowDays,
    thisWindow: `${digest.thisStart}..${digest.thisEnd}`,
    prevWindow: `${digest.prevStart}..${digest.prevEnd}`,
    thisTotalUsd: digest.thisTotal,
    prevTotalUsd: digest.prevTotal,
    thisEvents: digest.thisEvents,
    prevEvents: digest.prevEvents,
    deltaPct: digest.deltaPct,
    topCount: digest.topFeatures.length,
    biggestMover: digest.biggestMover?.feature ?? null,
    inboundScanFailures,
  });
}
