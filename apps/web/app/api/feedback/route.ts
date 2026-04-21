import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { hashIdentifier } from "@askarthur/utils";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";
import { z } from "zod";

const FeedbackSchema = z.object({
  verdictGiven: z.enum(["SAFE", "UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"]),
  userSays: z.enum(["correct", "false_positive", "false_negative"]),
  comment: z.string().max(500).optional(),
  contentHash: z.string().max(64).optional(),
});

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
