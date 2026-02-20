import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkFormRateLimit } from "@/lib/rateLimit";
import { hashIdentifier } from "@/lib/hash";
import { geolocateIP } from "@/lib/geolocate";
import { createServiceClient } from "@/lib/supabase";
import { featureFlags } from "@/lib/featureFlags";
import { normalizeURL, isURLFormat } from "@/lib/urlNormalize";
import { lookupWhois } from "@/lib/whoisLookup";
import { checkSSL } from "@/lib/sslCheck";
import { logger } from "@/lib/logger";

const URLItemSchema = z.object({
  url: z.string().min(1).max(2048),
  sourceType: z.string().max(50).optional(),
  context: z.string().max(200).optional(),
});

const URLCheckResultSchema = z.object({
  url: z.string(),
  isMalicious: z.boolean(),
  sources: z.array(z.string()),
});

const ReportSchema = z.object({
  urls: z.array(URLItemSchema).min(1).max(10),
  scamType: z.string().max(100).optional(),
  brandImpersonated: z.string().max(100).optional(),
  channel: z.string().max(50).optional(),
  analysisId: z.number().int().positive().optional(),
  urlCheckResults: z.array(URLCheckResultSchema).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 0. Feature flag guard
    if (!featureFlags.scamUrlReporting) {
      return NextResponse.json({ error: "Feature not enabled" }, { status: 404 });
    }

    // 1. Rate limit: 5/hour per IP (reuses form limiter)
    const ip =
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    const rateCheck = await checkFormRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "rate_limited", message: rateCheck.message },
        { status: 429 }
      );
    }

    // 2. Validate request body
    const body = await req.json();
    const parsed = ReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { urls, scamType, brandImpersonated, channel, analysisId, urlCheckResults } = parsed.data;

    // 3. Generate reporter hash from IP + User-Agent
    const ua = req.headers.get("user-agent") || "unknown";
    const reporterHash = await hashIdentifier(ip, ua);

    // 4. Geo-IP for region
    const geo = await geolocateIP(ip);

    // 5. Supabase client
    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 }
      );
    }

    // Build a lookup map for URL check results (from analysis)
    const checkResultMap = new Map<string, { isMalicious: boolean; sources: string[] }>();
    if (urlCheckResults) {
      for (const r of urlCheckResults) {
        checkResultMap.set(r.url, { isMalicious: r.isMalicious, sources: r.sources });
      }
    }

    // 6. Process each URL
    const results: Array<{
      normalizedUrl: string;
      domain: string;
      reportCount: number;
      whois?: {
        registrar: string | null;
        registrantCountry: string | null;
        domainAgeDays: number | null;
      };
    }> = [];

    for (const urlItem of urls) {
      // Validate URL format
      if (!isURLFormat(urlItem.url)) {
        continue;
      }

      // Normalize
      const norm = normalizeURL(urlItem.url);
      if (!norm) continue;

      const sourceType = urlItem.sourceType || "text";

      // Call upsert_scam_url RPC
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "upsert_scam_url",
        {
          p_normalized_url: norm.normalized,
          p_domain: norm.domain,
          p_subdomain: norm.subdomain,
          p_tld: norm.tld,
          p_full_path: norm.fullPath,
          p_source_type: sourceType,
          p_reporter_hash: reporterHash,
          p_scam_type: scamType || null,
          p_brand_impersonated: brandImpersonated || null,
          p_channel: channel || null,
          p_region: geo.region || null,
          p_analysis_id: analysisId || null,
        }
      );

      if (rpcError) {
        logger.error("upsert_scam_url RPC failed", {
          error: rpcError.message,
          code: rpcError.code,
        });
        continue;
      }

      const { scam_url_id, report_count, is_new } = rpcResult;
      const entry: (typeof results)[number] = {
        normalizedUrl: norm.normalized,
        domain: norm.domain,
        reportCount: report_count,
      };

      // For new URLs: apply GSB/VT results + WHOIS/SSL enrichment
      if (is_new) {
        // Copy GSB/VT results from analysis (passed in request body)
        const checkResult = checkResultMap.get(urlItem.url);
        const gsbFlagged = checkResult?.sources.includes("Google Safe Browsing") || false;
        const vtFlagged = checkResult?.sources.includes("VirusTotal") || false;

        const updateData: Record<string, unknown> = {};
        if (checkResult) {
          updateData.google_safe_browsing = gsbFlagged;
          if (vtFlagged) {
            updateData.virustotal_malicious = 3; // Flagged threshold
            updateData.virustotal_score = "flagged";
          }
        }

        // Check if domain already has WHOIS data in DB (domain-level cache)
        const { data: existingDomain } = await supabase
          .from("scam_urls")
          .select("whois_registrar, whois_registrant_country, whois_created_date, whois_expires_date, whois_name_servers, whois_is_private, whois_raw, whois_lookup_at, ssl_valid, ssl_issuer, ssl_days_remaining")
          .eq("domain", norm.domain)
          .not("whois_lookup_at", "is", null)
          .neq("id", scam_url_id)
          .limit(1)
          .single();

        if (existingDomain) {
          // Copy WHOIS + SSL data from existing domain entry
          updateData.whois_registrar = existingDomain.whois_registrar;
          updateData.whois_registrant_country = existingDomain.whois_registrant_country;
          updateData.whois_created_date = existingDomain.whois_created_date;
          updateData.whois_expires_date = existingDomain.whois_expires_date;
          updateData.whois_name_servers = existingDomain.whois_name_servers;
          updateData.whois_is_private = existingDomain.whois_is_private;
          updateData.whois_raw = existingDomain.whois_raw;
          updateData.whois_lookup_at = existingDomain.whois_lookup_at;
          updateData.ssl_valid = existingDomain.ssl_valid;
          updateData.ssl_issuer = existingDomain.ssl_issuer;
          updateData.ssl_days_remaining = existingDomain.ssl_days_remaining;

          entry.whois = {
            registrar: existingDomain.whois_registrar,
            registrantCountry: existingDomain.whois_registrant_country,
            domainAgeDays: existingDomain.whois_created_date
              ? Math.floor((Date.now() - new Date(existingDomain.whois_created_date).getTime()) / (1000 * 60 * 60 * 24))
              : null,
          };
        } else {
          // Fresh WHOIS + SSL lookups
          try {
            const [whois, ssl] = await Promise.all([
              lookupWhois(norm.domain),
              checkSSL(norm.domain),
            ]);

            updateData.whois_registrar = whois.registrar;
            updateData.whois_registrant_country = whois.registrantCountry;
            updateData.whois_created_date = whois.createdDate;
            updateData.whois_expires_date = whois.expiresDate;
            updateData.whois_name_servers = whois.nameServers;
            updateData.whois_is_private = whois.isPrivate;
            updateData.whois_raw = whois.raw;
            updateData.whois_lookup_at = new Date().toISOString();
            updateData.ssl_valid = ssl.valid;
            updateData.ssl_issuer = ssl.issuer;
            updateData.ssl_days_remaining = ssl.daysRemaining;

            entry.whois = {
              registrar: whois.registrar,
              registrantCountry: whois.registrantCountry,
              domainAgeDays: whois.createdDate
                ? Math.floor((Date.now() - new Date(whois.createdDate).getTime()) / (1000 * 60 * 60 * 24))
                : null,
            };
          } catch (err) {
            logger.error("WHOIS/SSL enrichment failed", { error: String(err) });
            // Mark that we attempted the lookup
            updateData.whois_lookup_at = new Date().toISOString();
          }
        }

        // Apply enrichment updates
        if (Object.keys(updateData).length > 0) {
          await supabase
            .from("scam_urls")
            .update(updateData)
            .eq("id", scam_url_id);
        }
      }

      results.push(entry);
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: "validation_error", message: "No valid URLs to report" },
        { status: 400 }
      );
    }

    return NextResponse.json({ reported: true, urls: results });
  } catch (err) {
    logger.error("Scam URL report error", { error: String(err) });
    return NextResponse.json(
      { error: "report_failed", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
