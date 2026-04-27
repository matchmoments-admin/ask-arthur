import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, rateLimitHeaders } from "@/lib/apiAuth";
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
      { status: 429, headers: { "Retry-After": "3600", ...rateLimitHeaders(auth) } }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { id } = await params;
  const clusterId = parseInt(id, 10);
  if (isNaN(clusterId) || clusterId <= 0) {
    return NextResponse.json(
      { error: "Invalid cluster ID" },
      { status: 400 }
    );
  }

  try {
    // Fetch cluster
    const { data: cluster, error: clusterError } = await supabase
      .from("scam_clusters")
      .select("*")
      .eq("id", clusterId)
      .single();

    if (clusterError || !cluster) {
      return NextResponse.json(
        { error: "Cluster not found" },
        { status: 404 }
      );
    }

    // Fetch member reports
    const { data: members } = await supabase
      .from("cluster_members")
      .select(
        "report_id, scam_reports(id, verdict, confidence_score, scam_type, channel, impersonated_brand, region, created_at)"
      )
      .eq("cluster_id", clusterId)
      .order("created_at", { ascending: false })
      .limit(50);

    const reports = (members || []).map((m: Record<string, unknown>) => {
      const report = m.scam_reports as Record<string, unknown> | null;
      return {
        reportId: report?.id,
        verdict: report?.verdict,
        confidenceScore: report?.confidence_score,
        scamType: report?.scam_type,
        channel: report?.channel,
        impersonatedBrand: report?.impersonated_brand,
        region: report?.region,
        reportedAt: report?.created_at,
      };
    });

    // Fetch shared entities across these reports
    const reportIds = reports.map((r) => r.reportId).filter(Boolean) as number[];
    let sharedEntities: Array<Record<string, unknown>> = [];

    if (reportIds.length > 0) {
      const { data: entityLinks } = await supabase
        .from("report_entity_links")
        .select(
          "entity_id, scam_entities(id, entity_type, normalized_value, report_count)"
        )
        .in("report_id", reportIds);

      // Count how many reports each entity appears in within this cluster
      const entityAppearances = new Map<number, { entity: Record<string, unknown>; count: number }>();
      for (const link of entityLinks || []) {
        const entity = link.scam_entities as unknown as Record<string, unknown> | null;
        if (!entity) continue;
        const eid = entity.id as number;
        const existing = entityAppearances.get(eid);
        if (existing) {
          existing.count++;
        } else {
          entityAppearances.set(eid, { entity, count: 1 });
        }
      }

      // Only include entities shared by 2+ reports in the cluster
      sharedEntities = Array.from(entityAppearances.values())
        .filter((e) => e.count >= 2)
        .sort((a, b) => b.count - a.count)
        .map((e) => ({
          entityId: e.entity.id,
          entityType: e.entity.entity_type,
          normalizedValue: e.entity.normalized_value,
          totalReportCount: e.entity.report_count,
          clusterAppearances: e.count,
        }));
    }

    return NextResponse.json(
      {
        cluster: {
          id: cluster.id,
          clusterType: cluster.cluster_type,
          primaryScamType: cluster.primary_scam_type,
          primaryBrand: cluster.primary_brand,
          memberCount: cluster.member_count,
          entityCount: cluster.entity_count,
          status: cluster.status,
          metadata: cluster.metadata,
          firstSeen: cluster.first_seen,
          lastSeen: cluster.last_seen,
        },
        sharedEntities,
        reports,
      },
      { headers: { ...CACHE_HEADERS, ...rateLimitHeaders(auth) } }
    );
  } catch (err) {
    logger.error("Cluster detail error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to fetch cluster details" },
      { status: 500 }
    );
  }
}
