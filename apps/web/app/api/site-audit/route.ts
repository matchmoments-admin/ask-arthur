import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { runSiteAudit } from "@askarthur/site-audit/scanner";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

const RequestSchema = z.object({
  url: z.string().url().max(2048),
});

export async function POST(req: NextRequest) {
  try {
    // 0. Feature flag guard
    if (!featureFlags.siteAudit) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Website Health Check is not yet available." },
        { status: 404 }
      );
    }

    // 1. Rate limit (5/hour per IP)
    const ip =
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    const rateCheck = await checkFormRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: rateCheck.message,
          resetAt: rateCheck.resetAt?.toISOString(),
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Remaining": "0",
            "Retry-After": rateCheck.resetAt
              ? String(Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 1000))
              : "3600",
          },
        }
      );
    }

    // 2. Validate input
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    // 3. Normalize URL (prepend https:// if missing)
    let url = parsed.data.url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    // 4. Run the audit
    const result = await runSiteAudit({ url });

    // 5. Store in database (non-blocking — don't fail the response on DB errors)
    let shareUrl: string | undefined;
    const supabase = createServiceClient();
    if (supabase) {
      try {
        const { data, error } = await supabase.rpc("upsert_site_and_store_audit", {
          p_domain: result.domain,
          p_normalized_url: result.url,
          p_overall_score: result.overallScore,
          p_grade: result.grade,
          p_test_results: result.checks,
          p_category_scores: result.categories,
          p_recommendations: result.recommendations,
          p_duration_ms: result.durationMs,
        });

        if (error) {
          logger.error("Failed to store site audit", { error: error.message, url: result.url });
        } else if (data && data.length > 0) {
          const token = data[0].share_token;
          if (token) {
            shareUrl = `https://askarthur.au/scan/${token}`;
          }
        }
      } catch (dbErr) {
        logger.error("Site audit DB write threw", {
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          url: result.url,
        });
      }
    }

    // 6. Return result with optional share URL
    return NextResponse.json({ ...result, shareUrl }, {
      headers: {
        "X-RateLimit-Remaining": String(rateCheck.remaining),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Site audit error", { error: message });

    // Return user-friendly error for known issues
    if (message.includes("private or internal")) {
      return NextResponse.json(
        { error: "invalid_url", message: "This URL cannot be scanned." },
        { status: 400 }
      );
    }

    if (message.includes("Could not extract domain")) {
      return NextResponse.json(
        { error: "invalid_url", message: "Could not extract a valid domain from this URL." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "audit_failed", message: "Something went wrong running the health check. Please try again." },
      { status: 500 }
    );
  }
}
