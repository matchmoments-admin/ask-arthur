import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const entityId = parseInt(id, 10);
  if (isNaN(entityId) || entityId <= 0) {
    return NextResponse.json(
      { error: "Invalid entity ID" },
      { status: 400 }
    );
  }

  try {
    // Fetch entity
    const { data: entity, error: entityError } = await supabase
      .from("scam_entities")
      .select("*")
      .eq("id", entityId)
      .single();

    if (entityError || !entity) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404 }
      );
    }

    // Fetch linked reports with details
    const { data: links } = await supabase
      .from("report_entity_links")
      .select(
        "role, extraction_method, scam_reports(id, verdict, confidence_score, scam_type, channel, impersonated_brand, region, created_at)"
      )
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(50);

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

    // Compute verdict distribution
    const verdictCounts: Record<string, number> = {};
    const scamTypes: Record<string, number> = {};
    for (const r of reports) {
      if (r.verdict) {
        verdictCounts[r.verdict as string] =
          (verdictCounts[r.verdict as string] || 0) + 1;
      }
      if (r.scamType) {
        scamTypes[r.scamType as string] =
          (scamTypes[r.scamType as string] || 0) + 1;
      }
    }

    // Check cluster membership
    const { data: clusterLinks } = await supabase
      .from("report_entity_links")
      .select("scam_reports(cluster_id)")
      .eq("entity_id", entityId)
      .not("scam_reports.cluster_id", "is", null)
      .limit(10);

    const clusterIds = [
      ...new Set(
        (clusterLinks || [])
          .map(
            (l: Record<string, unknown>) =>
              (l.scam_reports as Record<string, unknown> | null)?.cluster_id
          )
          .filter(Boolean)
      ),
    ];

    return NextResponse.json(
      {
        entity: {
          id: entity.id,
          entityType: entity.entity_type,
          normalizedValue: entity.normalized_value,
          reportCount: entity.report_count,
          firstSeen: entity.first_seen,
          lastSeen: entity.last_seen,
          enrichmentStatus: entity.enrichment_status,
          enrichmentData: entity.enrichment_data,
          riskScore: entity.risk_score,
          riskLevel: entity.risk_level,
          riskFactors: entity.risk_factors,
          provenanceTier: entity.provenance_tier,
        },
        summary: {
          verdictDistribution: verdictCounts,
          scamTypes,
          clusterIds,
        },
        reports,
      },
      { headers: CACHE_HEADERS }
    );
  } catch (err) {
    logger.error("Entity detail error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to fetch entity details" },
      { status: 500 }
    );
  }
}
