import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { hashIdentifier } from "@askarthur/utils";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";
import { z } from "zod";

const REASON_CODES = [
  "not_a_scam",
  "missed_something",
  "too_confusing",
  "wrong_details",
  "other",
] as const;

const FeedbackSchema = z.object({
  verdictGiven: z.enum(["SAFE", "UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"]),
  userSays: z.enum(["correct", "false_positive", "false_negative", "user_reported"]),
  comment: z.string().max(2000).optional(),
  contentHash: z.string().max(64).optional(),
  // P0 V2 additions — all optional so pre-V2 clients keep working
  scamReportId: z.coerce.number().int().positive().optional(),
  analysisId: z.string().max(128).optional(),
  reasonCodes: z.array(z.enum(REASON_CODES)).max(10).optional(),
  trainingConsent: z.boolean().optional(),
  locale: z.string().max(16).optional(),
});

function parseUserAgentFamily(ua: string): string {
  if (/edg\//i.test(ua)) return "edge";
  if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) return "chrome";
  if (/firefox\//i.test(ua)) return "firefox";
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return "safari";
  if (/crios\//i.test(ua)) return "chrome-ios";
  if (/fxios\//i.test(ua)) return "firefox-ios";
  return "other";
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    const rl = await checkRateLimit(ip, ua);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = await req.json();
    const parsed = FeedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid feedback data." }, { status: 400 });
    }

    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
    }

    const reporterHash = await hashIdentifier(ip, ua);

    const { error } = await supabase.from("verdict_feedback").insert({
      reporter_hash: reporterHash,
      verdict_given: parsed.data.verdictGiven,
      user_says: parsed.data.userSays,
      comment: parsed.data.comment || null,
      submitted_content_hash: parsed.data.contentHash || null,
      scam_report_id: parsed.data.scamReportId ?? null,
      analysis_id: parsed.data.analysisId ?? null,
      reason_codes: parsed.data.reasonCodes ?? [],
      training_consent: parsed.data.trainingConsent ?? false,
      user_agent_family: parseUserAgentFamily(ua),
      locale: parsed.data.locale ?? "en-AU",
    });

    if (error) {
      logger.error("Failed to store verdict feedback", { error: error.message });
      return NextResponse.json({ error: "Failed to store feedback." }, { status: 500 });
    }

    return NextResponse.json({ submitted: true });
  } catch (err) {
    logger.error("Feedback route error", { error: String(err) });
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
