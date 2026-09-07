import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { hashConfirmationToken } from "@/lib/newsletter-subscription";

const Body = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = await checkFormRateLimit(ip);
    if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_confirmation" }, { status: 400, headers });
    const supabase = createServiceClient();
    if (!supabase) throw new Error("store_unavailable");
    const { data, error } = await supabase.rpc("confirm_newsletter_subscription", {
      p_token_hash: hashConfirmationToken(parsed.data.token),
    });
    if (error) throw new Error("store_unavailable");
    if (data !== true) return NextResponse.json({ error: "expired_or_used_confirmation" }, { status: 400, headers });
    return NextResponse.json({ success: true }, { headers });
  } catch {
    return NextResponse.json({ error: "subscription_unavailable" }, {
      status: 503, headers: { ...headers, "Retry-After": "60" },
    });
  }
}
