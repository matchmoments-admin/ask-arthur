import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { normalizeURL } from "@askarthur/scam-engine/url-normalize";
import { checkURLReputation } from "@askarthur/scam-engine/safebrowsing";
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

    // 4. Check scam_urls table in Supabase
    let found = false;
    let threatLevel: "LOW" | "MEDIUM" | "HIGH" | undefined;
    let reportCount: number | undefined;

    const supabase = createServiceClient();
    if (supabase) {
      const { data } = await supabase
        .from("scam_urls")
        .select("confidence_level, report_count")
        .eq("normalized_url", norm.normalized)
        .eq("is_active", true)
        .single();

      if (data) {
        found = true;
        threatLevel = data.confidence_level;
        reportCount = data.report_count;
      }
    }

    // 5. If not found in DB, check URL reputation (Safe Browsing + VirusTotal)
    let safeBrowsing: { isMalicious: boolean; sources: string[] } | undefined;
    if (!found) {
      const results = await checkURLReputation([parsed.data.url]);
      if (results.length > 0 && results[0]) {
        safeBrowsing = {
          isMalicious: results[0].isMalicious,
          sources: results[0].sources,
        };
        if (results[0].isMalicious) {
          found = true;
          threatLevel = "HIGH";
        }
      }
    }

    // 6. Return response
    const response: ExtensionURLCheckResponse = {
      found,
      ...(threatLevel && { threatLevel }),
      ...(reportCount && { reportCount }),
      domain: norm.domain,
      ...(safeBrowsing && { safeBrowsing }),
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
