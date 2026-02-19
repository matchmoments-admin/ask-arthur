import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { sendWelcomeEmail } from "@/lib/resend";
import { checkFormRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

const WaitlistSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  subscribedWeekly: z.boolean().default(true),
  source: z.string().default("homepage"),
});

export async function POST(req: NextRequest) {
  try {
    // Rate limit form submissions
    const ip = req.headers.get("x-real-ip")
      || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "unknown";
    const rateCheck = await checkFormRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.message },
        { status: 429 }
      );
    }

    const body = await req.json();
    const parsed = WaitlistSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { email, subscribedWeekly, source } = parsed.data;
    const supabase = createServiceClient();
    if (!supabase) {
      sendWelcomeEmail(email).catch((err) =>
        logger.error("Failed to send welcome email", { error: String(err) })
      );
      return NextResponse.json({ success: true });
    }

    // Insert into waitlist (upsert to handle duplicates gracefully)
    const { error: waitlistError } = await supabase
      .from("waitlist")
      .upsert(
        { email, source, subscribed_weekly: subscribedWeekly },
        { onConflict: "email" }
      );

    if (waitlistError) {
      logger.error("Waitlist insert error", { error: String(waitlistError) });
      return NextResponse.json(
        { error: "Failed to join waitlist" },
        { status: 500 }
      );
    }

    // If they opted into weekly alerts, also add to email_subscribers
    if (subscribedWeekly) {
      await supabase
        .from("email_subscribers")
        .upsert(
          {
            email,
            is_active: true,
            consent_at: new Date().toISOString(),
            consent_source: `waitlist_${source}`,
          },
          { onConflict: "email" }
        );
    }

    // Send welcome email (fire-and-forget)
    sendWelcomeEmail(email).catch((err) =>
      logger.error("Failed to send welcome email", { error: String(err) })
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
