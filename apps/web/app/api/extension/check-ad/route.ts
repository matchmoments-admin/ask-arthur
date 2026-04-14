import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { validateExtensionRequest } from "../_lib/auth";

export async function GET(req: NextRequest) {
  try {
    // 1. Auth + rate limit
    const auth = await validateExtensionRequest(req);
    if (!auth.valid) {
      return NextResponse.json(
        { error: auth.error },
        {
          status: auth.status,
          ...(auth.retryAfter && {
            headers: { "Retry-After": auth.retryAfter },
          }),
        }
      );
    }

    // 2. Extract query params
    const { searchParams } = new URL(req.url);
    const hash = searchParams.get("hash");

    if (!hash || hash.length < 16 || hash.length > 128) {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid or missing hash parameter" },
        { status: 400 }
      );
    }

    // 3. Query flagged_ads
    const supabase = createServiceClient();
    if (!supabase) {
      // Graceful fallback — no flags found
      return NextResponse.json(
        { flagCount: 0, verdict: null },
        { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
      );
    }

    const { data, error } = await supabase
      .from("flagged_ads")
      .select("flag_count, verdict")
      .eq("ad_text_hash", hash)
      .single();

    if (error || !data) {
      // No record found — not flagged
      return NextResponse.json(
        { flagCount: 0, verdict: null },
        { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
      );
    }

    return NextResponse.json(
      { flagCount: data.flag_count, verdict: data.verdict },
      { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
    );
  } catch (err) {
    logger.error("Check ad error", { error: String(err) });
    return NextResponse.json(
      { error: "check_failed", message: "Something went wrong." },
      { status: 500 }
    );
  }
}
