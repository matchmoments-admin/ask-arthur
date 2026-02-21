import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { hashIdentifier } from "@askarthur/utils/hash";
import { geolocateIP } from "@askarthur/scam-engine/geolocate";
import { createServiceClient } from "@askarthur/supabase/server";
import { lookupPhoneNumber } from "@/lib/twilioLookup";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  normalizePhoneE164,
  normalizeEmail,
  extractEmailDomain,
  isValidPhoneFormat,
  isValidEmailFormat,
} from "@askarthur/scam-engine/phone-normalize";
import { logger } from "@askarthur/utils/logger";

const ContactSchema = z.object({
  type: z.enum(["phone", "email"]),
  value: z.string().min(1).max(200),
  context: z.string().max(200).default(""),
});

const ReportSchema = z.object({
  contacts: z.array(ContactSchema).min(1).max(5),
  scamType: z.string().max(100).optional(),
  brandImpersonated: z.string().max(100).optional(),
  channel: z.string().max(50).optional(),
  analysisId: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 0. Feature flag guard
    if (!featureFlags.scamContactReporting) {
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

    const { contacts, scamType, brandImpersonated, channel, analysisId } = parsed.data;

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

    // 6. Process each contact
    const results: Array<{
      value: string;
      reportCount: number;
      carrier?: string;
      lineType?: string;
    }> = [];

    for (const contact of contacts) {
      let normalizedValue: string | null = null;

      if (contact.type === "phone") {
        if (!isValidPhoneFormat(contact.value)) {
          continue; // Skip invalid phone numbers
        }
        normalizedValue = normalizePhoneE164(contact.value);
        if (!normalizedValue) continue;
      } else {
        if (!isValidEmailFormat(contact.value)) {
          continue; // Skip invalid emails
        }
        normalizedValue = normalizeEmail(contact.value);
      }

      // Call upsert_scam_contact RPC
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "upsert_scam_contact",
        {
          p_normalized_value: normalizedValue,
          p_contact_type: contact.type,
          p_reporter_hash: reporterHash,
          p_scam_type: scamType || null,
          p_brand_impersonated: brandImpersonated || null,
          p_channel: channel || null,
          p_region: geo.region || null,
          p_analysis_id: analysisId || null,
        }
      );

      if (rpcError) {
        logger.error("upsert_scam_contact RPC failed", {
          error: rpcError.message,
          code: rpcError.code,
        });
        continue;
      }

      const { scam_contact_id, report_count, is_new } = rpcResult;
      const entry: (typeof results)[number] = {
        value: normalizedValue,
        reportCount: report_count,
      };

      // Twilio enrichment for new phone contacts
      if (is_new && contact.type === "phone") {
        try {
          const lookup = await lookupPhoneNumber(normalizedValue);
          await supabase
            .from("scam_contacts")
            .update({
              current_carrier: lookup.carrier,
              line_type: lookup.lineType,
              is_voip: lookup.isVoip,
              country_code: lookup.countryCode,
            })
            .eq("id", scam_contact_id);

          entry.carrier = lookup.carrier || undefined;
          entry.lineType = lookup.lineType || undefined;
        } catch (err) {
          logger.error("Twilio enrichment failed", { error: String(err) });
        }
      }

      // Email domain extraction for new email contacts
      if (is_new && contact.type === "email") {
        const domain = extractEmailDomain(normalizedValue);
        if (domain) {
          await supabase
            .from("scam_contacts")
            .update({ email_domain: domain })
            .eq("id", scam_contact_id);
        }
      }

      results.push(entry);
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: "validation_error", message: "No valid contacts to report" },
        { status: 400 }
      );
    }

    return NextResponse.json({ reported: true, contacts: results });
  } catch (err) {
    logger.error("Scam contact report error", { error: String(err) });
    return NextResponse.json(
      { error: "report_failed", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
