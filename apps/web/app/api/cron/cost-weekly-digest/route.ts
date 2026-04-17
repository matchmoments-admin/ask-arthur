import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sunday 22:00 UTC (= Monday 08:00 AEST) via vercel.json cron. DMs the
 * admin Telegram chat with last-week total, previous-week total, WoW
 * delta, and top-5 features by spend over the last 7 days.
 *
 * Unconditional send — every week regardless of activity, so "quiet
 * week" is information too.
 */
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

  const now = Date.now();
  const dayMs = 86400000;
  const sevenDaysAgo = new Date(now - 7 * dayMs).toISOString().slice(0, 10);
  const fourteenDaysAgo = new Date(now - 14 * dayMs).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("daily_cost_summary")
    .select("day, feature, provider, event_count, total_cost_usd")
    .gte("day", fourteenDaysAgo)
    .order("day", { ascending: false });

  if (error) {
    logger.error("cost-weekly-digest: query failed", { error: error.message });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = (data ?? []).map((r) => ({
    day: r.day as string,
    feature: r.feature as string,
    provider: r.provider as string,
    events: Number(r.event_count),
    cost: Number(r.total_cost_usd),
  }));

  const thisWeek = rows.filter((r) => r.day >= sevenDaysAgo);
  const prevWeek = rows.filter(
    (r) => r.day >= fourteenDaysAgo && r.day < sevenDaysAgo,
  );

  const thisTotal = thisWeek.reduce((s, r) => s + r.cost, 0);
  const prevTotal = prevWeek.reduce((s, r) => s + r.cost, 0);
  const thisEvents = thisWeek.reduce((s, r) => s + r.events, 0);

  let deltaLine: string;
  if (prevTotal === 0) {
    deltaLine = thisTotal > 0 ? "Delta: <b>new spend</b> 🆕" : "Delta: —";
  } else {
    const pct = ((thisTotal - prevTotal) / prevTotal) * 100;
    const arrow = pct >= 50 ? "🔺" : pct >= 0 ? "↗" : "↘";
    const sign = pct >= 0 ? "+" : "";
    deltaLine = `Delta: <b>${sign}${pct.toFixed(1)}%</b> ${arrow}`;
  }

  // Top 5 features by spend across this week.
  const featureMap = new Map<string, { cost: number; events: number; provider: string }>();
  for (const r of thisWeek) {
    const key = `${r.feature}|${r.provider}`;
    const prev = featureMap.get(key) ?? { cost: 0, events: 0, provider: r.provider };
    featureMap.set(key, {
      cost: prev.cost + r.cost,
      events: prev.events + r.events,
      provider: r.provider,
    });
  }
  const top = Array.from(featureMap.entries())
    .map(([key, v]) => ({
      feature: key.split("|")[0],
      provider: v.provider,
      cost: v.cost,
      events: v.events,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);

  const weekEnding = new Date(now).toISOString().slice(0, 10);
  const lines: string[] = [
    `📊 <b>Ask Arthur cost digest — week ending ${weekEnding} UTC</b>`,
    ``,
    `This week:   <b>$${thisTotal.toFixed(2)}</b> across ${thisEvents.toLocaleString()} events`,
    `Last week:   $${prevTotal.toFixed(2)}`,
    deltaLine,
  ];

  if (top.length > 0) {
    lines.push(``, `<b>Top features this week:</b>`);
    for (const t of top) {
      lines.push(
        `• ${t.feature} (${t.provider}) — $${t.cost.toFixed(
          2,
        )} · ${t.events.toLocaleString()} events`,
      );
    }
  } else {
    lines.push(``, `<i>No cost events logged this week.</i>`);
  }

  lines.push(``, `Full breakdown: https://askarthur.au/admin/costs`);

  await sendAdminTelegramMessage(lines.join("\n"));

  return NextResponse.json({
    thisTotalUsd: thisTotal,
    prevTotalUsd: prevTotal,
    thisEvents,
    topCount: top.length,
  });
}
