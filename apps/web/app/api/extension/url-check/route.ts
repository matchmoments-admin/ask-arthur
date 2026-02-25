import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { normalizeURL } from "@askarthur/scam-engine/url-normalize";
import { checkURLReputation } from "@askarthur/scam-engine/safebrowsing";
import { resolveRedirectChain } from "@askarthur/scam-engine/redirect-resolver";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { validateExtensionRequest } from "../_lib/auth";
import type { ExtensionURLCheckResponse } from "@askarthur/types";

const URLCheckSchema = z.object({
  url: z.string().url().max(2048),
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
    const parsed = URLCheckSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    // 3. Normalize URL
    const norm = normalizeURL(parsed.data.url);
    if (!norm) {
      return NextResponse.json(
        { error: "validation_error", message: "Could not normalize URL" },
        { status: 400 }
      );
    }

    // 4. Resolve redirects when feature flag is on
    let redirectInfo: { finalUrl: string; hopCount: number; isShortened: boolean } | undefined;
    let finalNormalized: string | undefined;
    if (featureFlags.redirectResolve) {
      const chain = await resolveRedirectChain(parsed.data.url);
      if (chain.finalUrl !== chain.originalUrl) {
        redirectInfo = {
          finalUrl: chain.finalUrl,
          hopCount: chain.hopCount,
          isShortened: chain.isShortened,
        };
        const finalNorm = normalizeURL(chain.finalUrl);
        if (finalNorm) {
          finalNormalized = finalNorm.normalized;
        }
      }
    }

    // 5. Check scam_urls table in Supabase (original + final URL)
    let found = false;
    let threatLevel: "LOW" | "MEDIUM" | "HIGH" | undefined;
    let reportCount: number | undefined;

    const supabase = createServiceClient();
    if (supabase) {
      const urlsToCheck = [norm.normalized];
      if (finalNormalized && finalNormalized !== norm.normalized) {
        urlsToCheck.push(finalNormalized);
      }

      for (const normalizedUrl of urlsToCheck) {
        const { data } = await supabase
          .from("scam_urls")
          .select("confidence_level, report_count")
          .eq("normalized_url", normalizedUrl)
          .eq("is_active", true)
          .single();

        if (data) {
          found = true;
          threatLevel = data.confidence_level;
          reportCount = data.report_count;
          break;
        }
      }
    }

    // 6. If not found in DB, check URL reputation (Safe Browsing + VirusTotal)
    let safeBrowsing: { isMalicious: boolean; sources: string[] } | undefined;
    if (!found) {
      const urlsToCheck = [parsed.data.url];
      if (redirectInfo && redirectInfo.finalUrl !== parsed.data.url) {
        urlsToCheck.push(redirectInfo.finalUrl);
      }
      const results = await checkURLReputation(urlsToCheck);
      for (const result of results) {
        if (result.isMalicious) {
          safeBrowsing = {
            isMalicious: true,
            sources: result.sources,
          };
          found = true;
          threatLevel = "HIGH";
          break;
        }
      }
      // If none malicious, use first result
      if (!safeBrowsing && results.length > 0 && results[0]) {
        safeBrowsing = {
          isMalicious: results[0].isMalicious,
          sources: results[0].sources,
        };
      }
    }

    // 7. Return response
    const response: ExtensionURLCheckResponse = {
      found,
      ...(threatLevel && { threatLevel }),
      ...(reportCount && { reportCount }),
      domain: norm.domain,
      ...(safeBrowsing && { safeBrowsing }),
      ...(redirectInfo && { redirect: redirectInfo }),
    };

    return NextResponse.json(response, {
      headers: { "X-RateLimit-Remaining": String(auth.remaining) },
    });
  } catch (err) {
    logger.error("Extension URL check error", { error: String(err) });
    return NextResponse.json(
      { error: "check_failed", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
