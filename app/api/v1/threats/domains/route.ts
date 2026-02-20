import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  // API key authentication
  const auth = await validateApiKey(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  if (auth.rateLimited) {
    return NextResponse.json(
      { error: "Daily API limit exceeded. Resets at midnight UTC." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Parse query parameters
  const { searchParams } = req.nextUrl;
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "30"), 1), 90);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50"), 1), 200);

  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    const { data: urls, error } = await supabase
      .from("scam_urls")
      .select("domain, tld, report_count, unique_reporter_count, confidence_score, confidence_level, brand_impersonated, whois_registrar, whois_registrant_country, whois_created_date, whois_is_private, ssl_valid, ssl_issuer, last_reported_at")
      .eq("is_active", true)
      .gte("last_reported_at", since.toISOString());

    if (error) {
      logger.error("Domain aggregation query error", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch domain data" },
        { status: 500 }
      );
    }

    // Aggregate breakdowns
    const registrarBreakdown = new Map<string, number>();
    const tldBreakdown = new Map<string, number>();
    const countryBreakdown = new Map<string, number>();

    // Aggregate by domain
    const domainMap = new Map<
      string,
      {
        domain: string;
        tld: string;
        urlCount: number;
        totalReports: number;
        totalUniqueReporters: number;
        highestConfidenceScore: number;
        highestConfidenceLevel: string;
        brands: Set<string>;
        registrar: string | null;
        registrantCountry: string | null;
        domainAgeDays: number | null;
        isPrivate: boolean;
        sslValid: boolean | null;
        sslIssuer: string | null;
      }
    >();

    for (const url of urls || []) {
      const key = url.domain;

      // Track breakdowns (domain-level, counted once per domain)
      if (!domainMap.has(key)) {
        if (url.whois_registrar) {
          registrarBreakdown.set(url.whois_registrar, (registrarBreakdown.get(url.whois_registrar) || 0) + 1);
        }
        if (url.tld) {
          tldBreakdown.set(url.tld, (tldBreakdown.get(url.tld) || 0) + 1);
        }
        if (url.whois_registrant_country) {
          countryBreakdown.set(url.whois_registrant_country, (countryBreakdown.get(url.whois_registrant_country) || 0) + 1);
        }
      }

      const domainAgeDays = url.whois_created_date
        ? Math.floor((Date.now() - new Date(url.whois_created_date).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const existing = domainMap.get(key);
      if (existing) {
        existing.urlCount++;
        existing.totalReports += url.report_count;
        existing.totalUniqueReporters += url.unique_reporter_count;
        if (url.brand_impersonated) existing.brands.add(url.brand_impersonated);
        if (url.confidence_score > existing.highestConfidenceScore) {
          existing.highestConfidenceScore = url.confidence_score;
          existing.highestConfidenceLevel = url.confidence_level;
        }
      } else {
        domainMap.set(key, {
          domain: key,
          tld: url.tld,
          urlCount: 1,
          totalReports: url.report_count,
          totalUniqueReporters: url.unique_reporter_count,
          highestConfidenceScore: url.confidence_score,
          highestConfidenceLevel: url.confidence_level,
          brands: new Set(url.brand_impersonated ? [url.brand_impersonated] : []),
          registrar: url.whois_registrar,
          registrantCountry: url.whois_registrant_country,
          domainAgeDays,
          isPrivate: url.whois_is_private || false,
          sslValid: url.ssl_valid,
          sslIssuer: url.ssl_issuer,
        });
      }
    }

    // Sort domains by total reports descending, limit
    const domains = Array.from(domainMap.values())
      .sort((a, b) => b.totalReports - a.totalReports)
      .slice(0, limit)
      .map((d) => ({
        domain: d.domain,
        tld: d.tld,
        url_count: d.urlCount,
        total_reports: d.totalReports,
        total_unique_reporters: d.totalUniqueReporters,
        confidence_score: d.highestConfidenceScore,
        confidence_level: d.highestConfidenceLevel,
        brands_impersonated: Array.from(d.brands),
        registrar: d.registrar,
        registrant_country: d.registrantCountry,
        domain_age_days: d.domainAgeDays,
        whois_private: d.isPrivate,
        ssl_valid: d.sslValid,
        ssl_issuer: d.sslIssuer,
      }));

    // Sort breakdowns by count descending, convert to objects
    const sortedRegistrars = Object.fromEntries(
      Array.from(registrarBreakdown.entries()).sort((a, b) => b[1] - a[1])
    );
    const sortedTlds = Object.fromEntries(
      Array.from(tldBreakdown.entries()).sort((a, b) => b[1] - a[1])
    );
    const sortedCountries = Object.fromEntries(
      Array.from(countryBreakdown.entries()).sort((a, b) => b[1] - a[1])
    );

    // Domain age statistics
    const domainAges = Array.from(domainMap.values())
      .map((d) => d.domainAgeDays)
      .filter((age): age is number => age !== null);

    const ageStats = domainAges.length > 0
      ? {
          under_30_days: domainAges.filter((a) => a < 30).length,
          under_90_days: domainAges.filter((a) => a < 90).length,
          under_365_days: domainAges.filter((a) => a < 365).length,
          median_days: domainAges.sort((a, b) => a - b)[Math.floor(domainAges.length / 2)],
          total_with_whois: domainAges.length,
        }
      : null;

    return NextResponse.json(
      {
        meta: {
          period_days: days,
          total_domains: domainMap.size,
          total_urls: urls?.length || 0,
          generated_at: new Date().toISOString(),
        },
        domains,
        registrar_breakdown: sortedRegistrars,
        tld_breakdown: sortedTlds,
        country_breakdown: sortedCountries,
        domain_age_stats: ageStats,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    logger.error("Domain aggregation error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to fetch domain aggregation data" },
      { status: 500 }
    );
  }
}
