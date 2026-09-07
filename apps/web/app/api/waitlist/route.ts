import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { requestNewsletterConfirmation } from "@/lib/newsletter-subscription";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";

const WaitlistSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Please enter a valid email address")),
  subscribedWeekly: z.boolean().default(true),
  source: z.enum(["homepage"]).default("homepage"),
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

    const body = await req.json().catch(() => null);
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
      return NextResponse.json({ error: "waitlist_unavailable" }, {
        status: 503, headers: { "Retry-After": "60" },
      });
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

    if (subscribedWeekly) {
      await requestNewsletterConfirmation(supabase, email, `waitlist_${source}`);
    }
    return NextResponse.json({ success: true, confirmationRequired: subscribedWeekly });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
