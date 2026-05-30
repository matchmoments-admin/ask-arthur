import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { geolocateIP } from "@askarthur/scam-engine/geolocate";
import { createServiceClient } from "@askarthur/supabase/server";
import { lookupPhoneNumber } from "@/lib/twilioLookup";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  normalizePhoneE164,
  normalizeEmail,
  extractEmailDomain,
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

    // scamType / brandImpersonated / channel are still accepted in the payload
    // (back-compat) but now live on the linked scam_report, not the entity.
    const { contacts, analysisId } = parsed.data;

    // 3. Geo-IP for country_code on the entity
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
        normalizedValue = normalizePhoneE164(contact.value);
        if (!normalizedValue) continue;
      } else {
        if (!isValidEmailFormat(contact.value)) {
          continue; // Skip invalid emails
        }
        normalizedValue = normalizeEmail(contact.value);
      }

      // Upsert onto the unified scam_entities model (v170 report_scam_entity).
      // Replaces the dropped upsert_scam_contact RPC. analysisId is passed as
      // the optional report link — the RPC only links if it's a real
      // scam_reports.id, so a non-report value is a safe no-op. scamType /
      // brandImpersonated / channel / region live on the linked scam_report,
      // not the entity, so they're no longer passed here.
      const { data: rpcRows, error: rpcError } = await supabase.rpc(
        "report_scam_entity",
        {
          p_entity_type: contact.type,
          p_normalized_value: normalizedValue,
          p_raw_value: contact.value,
          p_country_code: geo.countryCode || null,
          p_report_id: analysisId ?? null,
          p_role: "sender",
        }
      );

      if (rpcError || !rpcRows || rpcRows.length === 0) {
        logger.error("report_scam_entity RPC failed", {
          error: rpcError?.message,
          code: rpcError?.code,
        });
        continue;
      }

      const { entity_id, is_new, report_count } = rpcRows[0];
      const entry: (typeof results)[number] = {
        value: normalizedValue,
        reportCount: report_count,
      };

      // Twilio enrichment for new phone entities → enrichment_data.twilio
      if (is_new && contact.type === "phone") {
        try {
          const lookup = await lookupPhoneNumber(normalizedValue);
          await supabase.rpc("merge_entity_enrichment_data", {
            p_entity_id: entity_id,
            p_key: "twilio",
            p_value: {
              carrier: lookup.carrier,
              line_type: lookup.lineType,
              is_voip: lookup.isVoip,
              country_code: lookup.countryCode,
            },
          });
          entry.carrier = lookup.carrier || undefined;
          entry.lineType = lookup.lineType || undefined;
        } catch (err) {
          logger.error("Twilio enrichment failed", { error: String(err) });
        }
      }

      // Email domain for new email entities → enrichment_data.email_domain
      if (is_new && contact.type === "email") {
        const domain = extractEmailDomain(normalizedValue);
        if (domain) {
          await supabase.rpc("merge_entity_enrichment_data", {
            p_entity_id: entity_id,
            p_key: "email_domain",
            p_value: domain,
          });
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
