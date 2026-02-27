import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { runSiteAudit } from "@askarthur/site-audit/scanner";
import { logger } from "@askarthur/utils/logger";

const RequestSchema = z.object({
  url: z.string().url().max(2048),
});

export async function POST(req: NextRequest) {
  try {
    // 0. Feature flag guard
    if (!featureFlags.siteAudit) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Website Safety Audit is not yet available." },
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

    // 5. Return result
    return NextResponse.json(result, {
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

    if (message.includes("Failed to fetch")) {
      return NextResponse.json(
        { error: "fetch_failed", message: "Could not reach this website. Check the URL and try again." },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { error: "audit_failed", message: "Something went wrong running the audit. Please try again." },
      { status: 500 }
    );
  }
}
