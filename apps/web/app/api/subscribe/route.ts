import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { requestNewsletterConfirmation } from "@/lib/newsletter-subscription";
import { logger } from "@askarthur/utils/logger";

// Known capture surfaces (#933 item 4). Stored verbatim as consent_source so
// the weekly signal review can attribute subscriber growth per surface.
const KNOWN_SOURCES = [
  "blog_index",
  "blog_post",
  "charity_check",
  "clone_watch",
  "subscribe_page",
] as const;

const SubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Please enter a valid email address")),
  source: z.enum(KNOWN_SOURCES).optional(),
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
    const parsed = SubscribeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { email, source } = parsed.data;
    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ error: "subscription_unavailable" }, {
        status: 503, headers: { "Retry-After": "60" },
      });
    }
    await requestNewsletterConfirmation(supabase, email, source ?? "subscribe_form");
    return NextResponse.json({ success: true, status: "confirmation_required" }, {
      status: 202, headers: { "Cache-Control": "no-store" },
    });
  } catch {
    logger.warn("newsletter_signup_failed");
    return NextResponse.json(
      { error: "subscription_unavailable" },
      { status: 503, headers: { "Retry-After": "900" } }
    );
  }
}
