import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { validateApiKey } from "@/lib/apiAuth";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { normalizePhoneE164, normalizeEmail, isValidPhoneFormat, isValidEmailFormat } from "@askarthur/scam-engine/phone-normalize";
import { logger } from "@askarthur/utils/logger";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _lookupLimiter: Ratelimit | null = null;

function getLookupLimiter() {
  if (!_lookupLimiter) {
    _lookupLimiter = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(10, "1 h"),
      prefix: "askarthur:lookup",
    });
  }
  return _lookupLimiter;
}

export async function GET(req: NextRequest) {
  try {
    // Feature flag guard
    if (!featureFlags.scamContactReporting) {
      return NextResponse.json({ error: "Feature not enabled" }, { status: 404 });
    }

    const query = req.nextUrl.searchParams.get("q")?.trim();
    if (!query) {
      return NextResponse.json(
        { error: "validation_error", message: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    // Determine contact type and normalize
    let normalizedValue: string | null = null;
    if (query.includes("@")) {
      if (!isValidEmailFormat(query)) {
        return NextResponse.json(
          { error: "validation_error", message: "Invalid email format" },
          { status: 400 }
        );
      }
      normalizedValue = normalizeEmail(query);
    } else {
      if (!isValidPhoneFormat(query)) {
        return NextResponse.json(
          { error: "validation_error", message: "Invalid phone format" },
          { status: 400 }
        );
      }
      normalizedValue = normalizePhoneE164(query);
    }

    if (!normalizedValue) {
      return NextResponse.json(
        { error: "validation_error", message: "Could not normalize the contact" },
        { status: 400 }
      );
    }

    // Check for B2B API key authentication
    const auth = await validateApiKey(req);
    const isAuthenticated = auth.valid && !auth.rateLimited;

    // Anonymous rate limiting (skip for authenticated B2B clients)
    if (!isAuthenticated && process.env.UPSTASH_REDIS_REST_URL) {
      const ip =
        req.headers.get("x-real-ip") ||
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown";

      const rateCheck = await getLookupLimiter().limit(ip);
      if (!rateCheck.success) {
        return NextResponse.json(
          { error: "rate_limited", message: "Too many lookups. Please try again later." },
          { status: 429, headers: { "Retry-After": "3600" } }
        );
      }
    }

    if (auth.valid && auth.rateLimited) {
      return NextResponse.json(
        { error: "Daily API limit exceeded. Resets at midnight UTC." },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }

    // Look up the contact
    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("scam_contacts")
      .select("*")
      .eq("normalized_value", normalizedValue)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { found: false },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
      );
    }

    // B2B authenticated response — full data
    if (isAuthenticated) {
      return NextResponse.json(
        {
          found: true,
          contactType: data.contact_type,
          normalizedValue: data.normalized_value,
          reportCount: data.report_count,
          uniqueReporterCount: data.unique_reporter_count,
          confidenceScore: data.confidence_score,
          confidenceLevel: data.confidence_level,
          currentCarrier: data.current_carrier,
          lineType: data.line_type,
          isVoip: data.is_voip,
          primaryScamType: data.primary_scam_type,
          brandImpersonated: data.brand_impersonated,
          countryCode: data.country_code,
          emailDomain: data.email_domain,
          firstReportedAt: data.first_reported_at,
          lastReportedAt: data.last_reported_at,
        },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
      );
    }

    // Anonymous response — limited data
    return NextResponse.json(
      {
        found: true,
        threatLevel: data.confidence_level,
        reportCount: data.report_count,
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    logger.error("Scam contact lookup error", { error: String(err) });
    return NextResponse.json(
      { error: "lookup_failed", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
