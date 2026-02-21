import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { validateApiKey } from "@/lib/apiAuth";
import { featureFlags } from "@/lib/featureFlags";
import { normalizeURL, isURLFormat } from "@/lib/urlNormalize";
import { logger } from "@/lib/logger";
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
      prefix: "askarthur:url-lookup",
    });
  }
  return _lookupLimiter;
}

export async function GET(req: NextRequest) {
  try {
    // Feature flag guard
    if (!featureFlags.scamUrlReporting) {
      return NextResponse.json({ error: "Feature not enabled" }, { status: 404 });
    }

    const { searchParams } = req.nextUrl;
    const query = searchParams.get("q")?.trim();
    const domainQuery = searchParams.get("domain")?.trim();

    if (!query && !domainQuery) {
      return NextResponse.json(
        { error: "validation_error", message: "Query parameter 'q' (URL) or 'domain' is required" },
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

    // Look up the URL or domain
    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    let data = null;
    let error = null;

    if (domainQuery) {
      // Domain-level lookup — return all URLs for the domain
      const result = await supabase
        .from("scam_urls")
        .select("*")
        .eq("domain", domainQuery.toLowerCase())
        .eq("is_active", true)
        .order("report_count", { ascending: false })
        .limit(20);
      data = result.data;
      error = result.error;

      if (error || !data || data.length === 0) {
        return NextResponse.json(
          { found: false },
          { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
        );
      }

      // Aggregate domain-level data
      const totalReports = data.reduce((sum, d) => sum + d.report_count, 0);
      const highestConfidence = data.reduce(
        (best, d) => (d.confidence_score > best.confidence_score ? d : best),
        data[0]
      );

      if (isAuthenticated) {
        return NextResponse.json(
          {
            found: true,
            domain: domainQuery.toLowerCase(),
            urlCount: data.length,
            totalReports,
            confidenceLevel: highestConfidence.confidence_level,
            confidenceScore: highestConfidence.confidence_score,
            whoisRegistrar: highestConfidence.whois_registrar,
            whoisCreatedDate: highestConfidence.whois_created_date,
            whoisRegistrantCountry: highestConfidence.whois_registrant_country,
            urls: data.map((d) => ({
              normalizedUrl: d.normalized_url,
              reportCount: d.report_count,
              confidenceLevel: d.confidence_level,
              googleSafeBrowsing: d.google_safe_browsing,
              brandImpersonated: d.brand_impersonated,
            })),
          },
          { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
        );
      }

      return NextResponse.json(
        {
          found: true,
          domain: domainQuery.toLowerCase(),
          urlCount: data.length,
          totalReports,
          threatLevel: highestConfidence.confidence_level,
        },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
      );
    }

    // URL-specific lookup
    if (query && !isURLFormat(query)) {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid URL format" },
        { status: 400 }
      );
    }

    const norm = normalizeURL(query!);
    if (!norm) {
      return NextResponse.json(
        { error: "validation_error", message: "Could not normalize the URL" },
        { status: 400 }
      );
    }

    const result = await supabase
      .from("scam_urls")
      .select("*")
      .eq("normalized_url", norm.normalized)
      .single();

    if (result.error || !result.data) {
      return NextResponse.json(
        { found: false },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
      );
    }

    const record = result.data;

    // B2B authenticated response — full data
    if (isAuthenticated) {
      return NextResponse.json(
        {
          found: true,
          normalizedUrl: record.normalized_url,
          domain: record.domain,
          subdomain: record.subdomain,
          tld: record.tld,
          reportCount: record.report_count,
          uniqueReporterCount: record.unique_reporter_count,
          confidenceScore: record.confidence_score,
          confidenceLevel: record.confidence_level,
          primaryScamType: record.primary_scam_type,
          brandImpersonated: record.brand_impersonated,
          googleSafeBrowsing: record.google_safe_browsing,
          virustotalMalicious: record.virustotal_malicious,
          virustotalScore: record.virustotal_score,
          whoisRegistrar: record.whois_registrar,
          whoisRegistrantCountry: record.whois_registrant_country,
          whoisCreatedDate: record.whois_created_date,
          whoisExpiresDate: record.whois_expires_date,
          whoisIsPrivate: record.whois_is_private,
          sslValid: record.ssl_valid,
          sslIssuer: record.ssl_issuer,
          sslDaysRemaining: record.ssl_days_remaining,
          firstReportedAt: record.first_reported_at,
          lastReportedAt: record.last_reported_at,
        },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
      );
    }

    // Anonymous response — limited data
    return NextResponse.json(
      {
        found: true,
        threatLevel: record.confidence_level,
        reportCount: record.report_count,
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    logger.error("Scam URL lookup error", { error: String(err) });
    return NextResponse.json(
      { error: "lookup_failed", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
