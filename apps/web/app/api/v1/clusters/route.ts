import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { jsonV1 } from "@/app/api/v1/_lib/json-response";

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

  const status = req.nextUrl.searchParams.get("status") || "active";
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") || "20", 10),
    100
  );
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);

  if (!["active", "dormant", "disrupted"].includes(status)) {
    return NextResponse.json(
      { error: "Invalid status. Must be one of: active, dormant, disrupted" },
      { status: 400 }
    );
  }

  try {
    const { data, error, count } = await supabase
      .from("scam_clusters")
      .select("*", { count: "exact" })
      .eq("status", status)
      .order("member_count", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error("Cluster list error", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch clusters" },
        { status: 500 }
      );
    }

    const clusters = (data || []).map((c) => ({
      id: c.id,
      clusterType: c.cluster_type,
      primaryScamType: c.primary_scam_type,
      primaryBrand: c.primary_brand,
      memberCount: c.member_count,
      entityCount: c.entity_count,
      status: c.status,
      firstSeen: c.first_seen,
      lastSeen: c.last_seen,
    }));

    return jsonV1(
      {
        total: count ?? 0,
        offset,
        limit,
        clusters,
      },
      { headers: CACHE_HEADERS }
    );
  } catch (err) {
    logger.error("Cluster list error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to fetch clusters" },
      { status: 500 }
    );
  }
}
