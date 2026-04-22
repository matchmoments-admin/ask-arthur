import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { normalizeURL, isURLFormat } from "@askarthur/scam-engine/url-normalize";
import {
  normalizeEmail,
  isValidEmailFormat,
} from "@askarthur/scam-engine/phone-normalize";
import { logger } from "@askarthur/utils/logger";
import { validateExtensionRequest } from "../_lib/auth";

const ReportSchema = z.object({
  senderEmail: z.string().min(1).max(200),
  subject: z.string().max(500),
  urls: z.array(z.string().max(2048)).max(20),
  verdict: z.string(),
  confidence: z.number().min(0).max(100),
});

export async function POST(req: NextRequest) {
  try {
    // 0. Feature flag guard
    if (!featureFlags.emailScanning) {
      return NextResponse.json({ error: "Feature not enabled" }, { status: 404 });
    }

    // 1. Auth + rate limit (extension auth, not IP-based)
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

    // 2. Validate request body
    const body = await req.json();
    const parsed = ReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { senderEmail, urls } = parsed.data;

    // 3. Reporter hash from install ID (already SHA-256'd in auth)
    const reporterHash = auth.installId;

    // 4. Supabase client
    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 }
      );
    }

    // 5. Report sender email as scam contact
    if (isValidEmailFormat(senderEmail)) {
      const normalizedEmail = normalizeEmail(senderEmail);

      const { error: contactError } = await supabase.rpc(
        "upsert_scam_contact",
        {
          p_normalized_value: normalizedEmail,
          p_contact_type: "email",
          p_reporter_hash: reporterHash,
          p_scam_type: null,
          p_brand_impersonated: null,
          p_channel: "email",
          p_region: null,
          p_analysis_id: null,
        }
      );

      if (contactError) {
        logger.error("upsert_scam_contact failed for email report", {
          error: contactError.message,
        });
      }
    }

    // 6. Report URLs as scam URLs
    for (const url of urls) {
      if (!isURLFormat(url)) continue;
      const norm = normalizeURL(url);
      if (!norm) continue;

      const { error: urlError } = await supabase.rpc("upsert_scam_url", {
        p_normalized_url: norm.normalized,
        p_domain: norm.domain,
        p_subdomain: norm.subdomain,
        p_tld: norm.tld,
        p_full_path: norm.fullPath,
        p_source_type: "email",
        p_reporter_hash: reporterHash,
        p_scam_type: null,
        p_brand_impersonated: null,
        p_channel: "email",
        p_region: null,
        p_analysis_id: null,
      });

      if (urlError) {
        logger.error("upsert_scam_url failed for email report", {
          error: urlError.message,
        });
      }
    }

    return NextResponse.json(
      { success: true },
      { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
    );
  } catch (err) {
    logger.error("Email report error", { error: String(err) });
    return NextResponse.json(
      { error: "report_failed", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
