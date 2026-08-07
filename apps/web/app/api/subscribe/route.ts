import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
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
  email: z.string().email("Please enter a valid email address"),
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

    const body = await req.json();
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
      return NextResponse.json({ success: true });
    }

    const { error } = await supabase
      .from("email_subscribers")
      .upsert(
        {
          email,
          is_active: true,
          consent_at: new Date().toISOString(),
          consent_source: source ?? "subscribe_form",
        },
        { onConflict: "email" }
      );

    if (error) {
      logger.error("Subscribe error", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to subscribe" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
