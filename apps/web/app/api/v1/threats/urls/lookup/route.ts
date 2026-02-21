import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { normalizeURL, isURLFormat } from "@/lib/urlNormalize";
import { logger } from "@askarthur/utils/logger";

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

  const url = req.nextUrl.searchParams.get("url")?.trim();
  if (!url) {
    return NextResponse.json(
      { error: "Query parameter 'url' is required" },
      { status: 400 }
    );
  }

  if (!isURLFormat(url)) {
    return NextResponse.json(
      { error: "Invalid URL format" },
      { status: 400 }
    );
  }

  const norm = normalizeURL(url);
  if (!norm) {
    return NextResponse.json(
      { error: "Could not normalize the URL" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabase
      .from("scam_urls")
      .select("*")
      .eq("normalized_url", norm.normalized)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { found: false, normalizedUrl: norm.normalized },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
      );
    }

    return NextResponse.json(
      {
        found: true,
        normalizedUrl: data.normalized_url,
        domain: data.domain,
        subdomain: data.subdomain,
        tld: data.tld,
        fullPath: data.full_path,
        sourceType: data.source_type,
        reportCount: data.report_count,
        uniqueReporterCount: data.unique_reporter_count,
        confidenceScore: data.confidence_score,
        confidenceLevel: data.confidence_level,
        primaryScamType: data.primary_scam_type,
        brandImpersonated: data.brand_impersonated,
        googleSafeBrowsing: data.google_safe_browsing,
        virustotalMalicious: data.virustotal_malicious,
        virustotalScore: data.virustotal_score,
        whois: {
          registrar: data.whois_registrar,
          registrantCountry: data.whois_registrant_country,
          createdDate: data.whois_created_date,
          expiresDate: data.whois_expires_date,
          nameServers: data.whois_name_servers,
          isPrivate: data.whois_is_private,
          lookupAt: data.whois_lookup_at,
        },
        ssl: {
          valid: data.ssl_valid,
          issuer: data.ssl_issuer,
          daysRemaining: data.ssl_days_remaining,
        },
        firstReportedAt: data.first_reported_at,
        lastReportedAt: data.last_reported_at,
        isActive: data.is_active,
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    logger.error("B2B URL lookup error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to fetch URL data" },
      { status: 500 }
    );
  }
}
