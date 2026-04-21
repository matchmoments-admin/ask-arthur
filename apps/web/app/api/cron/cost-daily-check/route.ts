import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every 6 hours (vercel.json: "0 *\/6 * * *"), checks today's cumulative
 * AI / paid-API spend via the `today_cost_total` view. If it exceeds
 * DAILY_COST_THRESHOLD_USD (default: $2), DMs the admin Telegram chat with
 * a breakdown of the top-3 contributing features. Silent otherwise.
 *
 * Authenticated via the CRON_SECRET bearer token auto-attached by Vercel
 * Cron, matching the pattern used by the other /api/cron/* routes.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const thresholdUsd = parseFloat(process.env.DAILY_COST_THRESHOLD_USD ?? "2");

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const { data: today, error: todayError } = await supabase
    .from("today_cost_total")
    .select("total_cost_usd, event_count")
    .single();

  if (todayError) {
    logger.error("cost-daily-check: query failed", { error: todayError.message });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const totalCostUsd = Number(today?.total_cost_usd ?? 0);
  const eventCount = Number(today?.event_count ?? 0);

  if (totalCostUsd <= thresholdUsd) {
    return NextResponse.json({
      belowThreshold: true,
      totalCostUsd,
      thresholdUsd,
      eventCount,
    });
  }

  // Over threshold — fetch top 3 contributing features for context.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const { data: topRows } = await supabase
    .from("daily_cost_summary")
    .select("feature, provider, event_count, total_cost_usd")
    .eq("day", todayUtc)
    .order("total_cost_usd", { ascending: false })
    .limit(10);

  const top = (topRows ?? []).map((r) => ({
    feature: r.feature as string,
    provider: r.provider as string,
    events: Number(r.event_count),
    cost: Number(r.total_cost_usd),
  }));

  // Phase 14 Sprint 2 PR B3: per-feature cost brake. If vuln_au_enrichment
  // exceeds the per-feature threshold, write a feature_brakes row so the
  // enrich-vulnerability Inngest function short-circuits until tomorrow.
  // The threshold is intentionally separate from DAILY_COST_THRESHOLD_USD —
  // a $5 burst on enrichment alone should pause enrichment even if total
  // spend is nowhere near the $2 Telegram threshold.
  const vulnEnrichThresholdUsd = parseFloat(
    process.env.VULN_AU_ENRICHMENT_CAP_USD ?? "5",
  );
  const vulnEnrichCost = top.find(
    (t) => t.feature === "vuln_au_enrichment",
  )?.cost ?? 0;
  let brakeSet = false;
  if (vulnEnrichCost > vulnEnrichThresholdUsd) {
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: brakeError } = await supabase
      .from("feature_brakes")
      .upsert(
        {
          feature: "vuln_au_enrichment",
          paused_until: pausedUntil,
          reason: `Daily spend $${vulnEnrichCost.toFixed(2)} exceeded $${vulnEnrichThresholdUsd} cap`,
          set_by: "cost-daily-check",
          set_cost_usd: vulnEnrichCost,
          set_threshold_usd: vulnEnrichThresholdUsd,
          set_at: new Date().toISOString(),
        },
        { onConflict: "feature" },
      );
    if (brakeError) {
      logger.error("failed to set vuln_au_enrichment brake", {
        error: brakeError.message,
      });
    } else {
      brakeSet = true;
      logger.warn("vuln_au_enrichment brake engaged", {
        costUsd: vulnEnrichCost,
        thresholdUsd: vulnEnrichThresholdUsd,
        pausedUntil,
      });
    }
  }

  // Truncate to top 3 for the Telegram message (UX — keep it scannable).
  const topForTelegram = top.slice(0, 3);

  const lines: string[] = [
    `⚠️ <b>Ask Arthur daily cost alert</b>`,
    ``,
    `Today's spend: <b>$${totalCostUsd.toFixed(2)}</b> across ${eventCount.toLocaleString()} events`,
    `Threshold: $${thresholdUsd.toFixed(2)}`,
    ``,
    `<b>Top features today:</b>`,
  ];
  for (const t of topForTelegram) {
    lines.push(
      `• ${t.feature} (${t.provider}) — $${t.cost.toFixed(
        2,
      )} · ${t.events.toLocaleString()} events`,
    );
  }
  if (brakeSet) {
    lines.push(
      "",
      `🛑 <b>vuln_au_enrichment brake engaged</b> — paused for 24h (spend $${vulnEnrichCost.toFixed(2)} > $${vulnEnrichThresholdUsd} cap)`,
    );
  }
  lines.push("", `Full breakdown: https://askarthur.au/admin/costs`);

  await sendAdminTelegramMessage(lines.join("\n"));

  return NextResponse.json({
    alerted: true,
    totalCostUsd,
    thresholdUsd,
    eventCount,
    top: topForTelegram,
    brakeSet,
    vulnEnrichCost,
  });
}
