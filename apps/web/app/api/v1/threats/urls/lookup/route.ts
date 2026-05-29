import { NextRequest, NextResponse } from "next/server";
import { guardV1 } from "@/lib/v1-guard";
import { createServiceClient } from "@askarthur/supabase/server";
import { normalizeURL, isURLFormat } from "@askarthur/scam-engine/url-normalize";
import { logger } from "@askarthur/utils/logger";

// Map of feed_sources values that mean "AU regulator confirmed" → friendly
// label for the API response. Keep in lockstep with the v97 source allowlist
// on feed_items + the entries that asic_investor_alerts.py writes to
// scam_urls.feed_sources[].
const REGULATOR_SOURCES: Record<string, string> = {
  scamwatch_alert: "Scamwatch",
  acsc: "ACSC",
  asic_investor: "ASIC",
};

function deriveRegulators(feedSources: string[] | null | undefined): {
  regulatorConfirmed: boolean;
  regulators: string[];
} {
  const sources = feedSources ?? [];
  const regulators = sources
    .map((s) => REGULATOR_SOURCES[s])
    .filter((label): label is string => Boolean(label));
  return {
    regulatorConfirmed: regulators.length > 0,
    regulators: Array.from(new Set(regulators)),
  };
}

export async function GET(req: NextRequest) {
  const guard = await guardV1(req);
  if (!guard.ok) return guard.error;

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

    const { regulatorConfirmed, regulators } = deriveRegulators(
      data.feed_sources as string[] | null,
    );

    return NextResponse.json(
      {
        found: true,
        normalizedUrl: data.normalized_url,
        // Authority-elevated fields surface near the top so they're hard to miss.
        regulatorConfirmed,
        regulators,
        feedSources: (data.feed_sources as string[] | null) ?? [],
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
