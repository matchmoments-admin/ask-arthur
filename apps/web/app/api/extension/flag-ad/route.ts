import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { validateExtensionRequest } from "../_lib/auth";

const FlagAdSchema = z.object({
  advertiserName: z.string().min(1).max(500),
  landingUrl: z.string().url().max(2048).nullable(),
  adTextHash: z.string().min(16).max(128),
  verdict: z.string().max(20).optional(),
  riskScore: z.number().min(0).max(100).optional(),
});

export async function POST(req: NextRequest) {
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

    // 2. Validate input
    const body = await req.json();
    const parsed = FlagAdSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { advertiserName, landingUrl, adTextHash, verdict, riskScore } = parsed.data;

    // 3. Hash the reporter for dedup (don't store raw install ID)
    const reporterData = new TextEncoder().encode(auth.installId);
    const reporterBuf = await crypto.subtle.digest("SHA-256", reporterData);
    const reporterHash = Array.from(new Uint8Array(reporterBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // 4. Upsert into flagged_ads
    const supabase = createServiceClient();
    if (!supabase) {
      logger.error("Supabase service client unavailable for flag-ad");
      return NextResponse.json(
        { error: "service_unavailable" },
        { status: 503 }
      );
    }

    // Check if this reporter already flagged this ad
    const { data: existing } = await supabase
      .from("flagged_ads")
      .select("id, flag_count, reporter_hashes")
      .eq("ad_text_hash", adTextHash)
      .single();

    let totalFlags: number;

    if (existing) {
      const reporters: string[] = existing.reporter_hashes ?? [];
      if (reporters.includes(reporterHash)) {
        // Already flagged by this user
        return NextResponse.json(
          { success: true, totalFlags: existing.flag_count },
          { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
        );
      }

      // Update existing record
      const { data: updated, error } = await supabase
        .from("flagged_ads")
        .update({
          flag_count: existing.flag_count + 1,
          reporter_hashes: [...reporters, reporterHash],
          last_flagged_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("flag_count")
        .single();

      if (error) {
        logger.error("Failed to update flagged_ads", { error: String(error) });
        return NextResponse.json(
          { error: "flag_failed" },
          { status: 500 }
        );
      }

      totalFlags = updated?.flag_count ?? existing.flag_count + 1;
    } else {
      // Insert new record
      const { data: inserted, error } = await supabase
        .from("flagged_ads")
        .insert({
          ad_text_hash: adTextHash,
          advertiser_name: advertiserName,
          landing_url: landingUrl,
          landing_page_domain: landingUrl ? new URL(landingUrl).hostname : null,
          verdict: verdict ?? null,
          risk_score: riskScore ?? 0,
          flag_count: 1,
          reporter_hashes: [reporterHash],
        })
        .select("flag_count")
        .single();

      if (error) {
        logger.error("Failed to insert flagged_ads", { error: String(error) });
        return NextResponse.json(
          { error: "flag_failed" },
          { status: 500 }
        );
      }

      totalFlags = inserted?.flag_count ?? 1;
    }

    return NextResponse.json(
      { success: true, totalFlags },
      { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
    );
  } catch (err) {
    logger.error("Flag ad error", { error: String(err) });
    return NextResponse.json(
      { error: "flag_failed", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
