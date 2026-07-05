import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

// Weekly digest of open Clone Watch lead-magnet leads. clone-list-request
// does NOT fire the real-time founder pings that /api/leads does, so this is
// the visibility surface — it surfaces the queue so leads don't go cold in the
// inbox. Reuses the existing Telegram + Slack notify plumbing.

export const dynamic = "force-dynamic";

interface LeadRow {
  email: string;
  company_name: string;
  created_at: string;
  assessment_data: { brand?: string; unmonitored_brand?: boolean } | null;
}

export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  const [weekRes, openRes] = await Promise.all([
    supabase
      .from("leads")
      .select("email, company_name, created_at, assessment_data")
      .eq("source", "clone_watch")
      .eq("status", "new")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("source", "clone_watch")
      .eq("status", "new"),
  ]);

  if (weekRes.error) {
    logger.error("clone-lead-digest: query failed", { error: weekRes.error.message });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = (weekRes.data as LeadRow[] | null) ?? [];
  const totalOpen = openRes.count ?? rows.length;

  // Quiet week → no digest (an empty "0 leads" ping reads as broken/noise).
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, count: 0, totalOpen });
  }

  const lines = rows.map((l) => {
    const ad = l.assessment_data ?? {};
    const flag = ad.unmonitored_brand ? " ⚠️ not-monitored" : "";
    return `• ${l.email} — ${ad.brand ?? "?"}${flag} (${l.company_name})`;
  });

  const body =
    `🔎 <b>Clone Watch leads — new this week: ${rows.length}</b> (${totalOpen} open total)\n\n` +
    lines.join("\n") +
    `\n\nWork them from your inbox — reply to book a call. ⚠️ = a brand we don't monitor yet (watch-list gap).`;

  try {
    await sendAdminTelegramMessage(body);
  } catch (e) {
    logger.warn("clone-lead-digest: telegram send failed", { error: String(e) });
  }

  if (process.env.SLACK_WEBHOOK_LEADS_URL) {
    const slackText = body.replace(/<\/?b>/g, "*");
    fetch(process.env.SLACK_WEBHOOK_LEADS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: slackText }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, count: rows.length, totalOpen });
}
