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
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "7"), 1), 90);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10"), 1), 50);

  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    const { data: urls, error } = await supabase
      .from("scam_urls")
      .select("domain, normalized_url, report_count, unique_reporter_count, confidence_level, brand_impersonated, source_type, whois_registrar, whois_created_date, last_reported_at")
      .eq("is_active", true)
      .gte("last_reported_at", since.toISOString())
      .order("report_count", { ascending: false });

    if (error) {
      logger.error("Trending URLs query error", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch trending URL data" },
        { status: 500 }
      );
    }

    // Aggregate by domain
    const grouped = new Map<
      string,
      {
        domain: string;
        urlCount: number;
        totalReports: number;
        brands: Set<string>;
        sourceTypes: Set<string>;
        whoisRegistrar: string | null;
        domainAgeDays: number | null;
        latestReport: string;
      }
    >();

    for (const url of urls || []) {
      const key = url.domain;
      const existing = grouped.get(key);

      const domainAgeDays = url.whois_created_date
        ? Math.floor((Date.now() - new Date(url.whois_created_date).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      if (existing) {
        existing.urlCount++;
        existing.totalReports += url.report_count;
        if (url.brand_impersonated) existing.brands.add(url.brand_impersonated);
        if (url.source_type) existing.sourceTypes.add(url.source_type);
        if (url.last_reported_at > existing.latestReport) {
          existing.latestReport = url.last_reported_at;
        }
      } else {
        grouped.set(key, {
          domain: key,
          urlCount: 1,
          totalReports: url.report_count,
          brands: new Set(url.brand_impersonated ? [url.brand_impersonated] : []),
          sourceTypes: new Set(url.source_type ? [url.source_type] : []),
          whoisRegistrar: url.whois_registrar,
          domainAgeDays,
          latestReport: url.last_reported_at,
        });
      }
    }

    // Sort by total reports descending, limit results
    const trending = Array.from(grouped.values())
      .sort((a, b) => b.totalReports - a.totalReports)
      .slice(0, limit)
      .map((t) => ({
        domain: t.domain,
        url_count: t.urlCount,
        total_reports: t.totalReports,
        brand_impersonated: Array.from(t.brands),
        source_types: Array.from(t.sourceTypes),
        whois_registrar: t.whoisRegistrar,
        domain_age_days: t.domainAgeDays,
        latest_report: t.latestReport,
      }));

    return NextResponse.json(
      {
        meta: {
          period_days: days,
          total_domains: grouped.size,
          generated_at: new Date().toISOString(),
        },
        trending,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    logger.error("Trending URLs error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to fetch trending URL data" },
      { status: 500 }
    );
  }
}
