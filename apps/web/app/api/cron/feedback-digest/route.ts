import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DigestRow {
  user_says: "correct" | "false_positive" | "false_negative" | "user_reported";
  verdict_given: "SAFE" | "UNCERTAIN" | "SUSPICIOUS" | "HIGH_RISK";
  n: number;
  content_hashes: string[] | null;
}

/**
 * Daily 09:00 UTC. Reads feedback_disagreement_24h (defined in
 * migration-v94) and DMs the admin Telegram chat with a summary, but only
 * if at least one disagreement landed (silent on quiet days).
 *
 * Authenticated via the CRON_SECRET bearer token, matching the pattern in
 * /api/cron/cost-daily-check.
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

  const { data, error } = await supabase
    .from("feedback_disagreement_24h")
    .select("*");

  if (error) {
    logger.error("feedback-digest: query failed", { error: error.message });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as DigestRow[];

  let total = 0;
  let correct = 0;
  let falsePos = 0;
  let falseNeg = 0;
  let userReported = 0;

  // verdict × user_says split for the false-negative-on-SAFE callout.
  const fnOnSafe: string[] = [];

  for (const r of rows) {
    total += r.n;
    if (r.user_says === "correct") correct += r.n;
    else if (r.user_says === "false_positive") falsePos += r.n;
    else if (r.user_says === "false_negative") {
      falseNeg += r.n;
      if (r.verdict_given === "SAFE" && r.content_hashes) {
        fnOnSafe.push(...r.content_hashes);
      }
    } else if (r.user_says === "user_reported") userReported += r.n;
  }

  const disagreements = falsePos + falseNeg + userReported;
  if (disagreements === 0) {
    return NextResponse.json({
      silent: true,
      total,
      correct,
      disagreements: 0,
    });
  }

  const lines: string[] = [
    `📬 <b>Ask Arthur feedback (24h)</b>`,
    ``,
    `Total submissions: <b>${total}</b> (${correct} ✓ correct)`,
    `Disagreements: <b>${disagreements}</b>`,
  ];

  if (falseNeg > 0) {
    lines.push(`• 🛑 false-negative: ${falseNeg}${fnOnSafe.length > 0 ? ` (on SAFE: ${fnOnSafe.length})` : ""}`);
  }
  if (userReported > 0) {
    lines.push(`• ⚠️ user-reported: ${userReported}`);
  }
  if (falsePos > 0) {
    lines.push(`• ℹ️ false-positive: ${falsePos}`);
  }

  if (fnOnSafe.length > 0) {
    const sample = fnOnSafe.slice(0, 5).map((h) => h.slice(0, 12));
    lines.push("", `<b>Top FN-on-SAFE hashes:</b>`, ...sample.map((h) => `<code>${h}</code>`));
  }

  lines.push("", `Triage queue: https://askarthur.au/admin/feedback`);

  await sendAdminTelegramMessage(lines.join("\n"));

  return NextResponse.json({
    alerted: true,
    total,
    correct,
    disagreements,
    falsePos,
    falseNeg,
    userReported,
    fnOnSafeCount: fnOnSafe.length,
  });
}
