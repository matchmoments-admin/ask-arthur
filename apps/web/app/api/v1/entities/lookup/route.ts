import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import type { EntityType } from "@askarthur/types";
import { logger } from "@askarthur/utils/logger";

const VALID_ENTITY_TYPES: EntityType[] = [
  "phone",
  "email",
  "url",
  "domain",
  "ip",
  "crypto_wallet",
  "bank_account",
];

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
};

export async function GET(req: NextRequest) {
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

  const type = req.nextUrl.searchParams.get("type")?.trim() as EntityType;
  const value = req.nextUrl.searchParams.get("value")?.trim();

  if (!type || !VALID_ENTITY_TYPES.includes(type)) {
    return NextResponse.json(
      {
        error: `Query parameter 'type' is required. Valid types: ${VALID_ENTITY_TYPES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (!value) {
    return NextResponse.json(
      { error: "Query parameter 'value' is required" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabase
      .from("scam_entities")
      .select("*")
      .eq("entity_type", type)
      .eq("normalized_value", value)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { found: false, entityType: type, value },
        { headers: CACHE_HEADERS }
      );
    }

    // Fetch linked report summaries (most recent 10)
    const { data: links } = await supabase
      .from("report_entity_links")
      .select(
        "role, extraction_method, report_id, scam_reports(id, verdict, confidence_score, scam_type, channel, impersonated_brand, region, created_at)"
      )
      .eq("entity_id", data.id)
      .order("created_at", { ascending: false })
      .limit(10);

    const reports = (links || []).map((link: Record<string, unknown>) => {
      const report = link.scam_reports as Record<string, unknown> | null;
      return {
        reportId: report?.id,
        role: link.role,
        extractionMethod: link.extraction_method,
        verdict: report?.verdict,
        confidenceScore: report?.confidence_score,
        scamType: report?.scam_type,
        channel: report?.channel,
        impersonatedBrand: report?.impersonated_brand,
        region: report?.region,
        reportedAt: report?.created_at,
      };
    });

    return NextResponse.json(
      {
        found: true,
        entity: {
          id: data.id,
          entityType: data.entity_type,
          normalizedValue: data.normalized_value,
          reportCount: data.report_count,
          firstSeen: data.first_seen,
          lastSeen: data.last_seen,
          enrichmentStatus: data.enrichment_status,
          enrichmentData: data.enrichment_data,
          riskScore: data.risk_score,
          riskLevel: data.risk_level,
          riskFactors: data.risk_factors,
          provenanceTier: data.provenance_tier,
        },
        recentReports: reports,
      },
      { headers: CACHE_HEADERS }
    );
  } catch (err) {
    logger.error("Entity lookup error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to look up entity" },
      { status: 500 }
    );
  }
}
