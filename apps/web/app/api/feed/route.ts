import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

const EMPTY_RESPONSE = { items: [], total: 0, page: 1, limit: 20, hasMore: false };

export async function GET(req: NextRequest) {
  try {
    if (!featureFlags.scamFeed) {
      return NextResponse.json(EMPTY_RESPONSE, { status: 200 });
    }

    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json(
        { items: [], total: 0, page: 1, limit: 20, hasMore: false },
        { status: 200 }
      );
    }

    const { searchParams } = req.nextUrl;
    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const rawLimit = parseInt(searchParams.get("limit") || "20", 10);
    const page = Math.max(1, Number.isNaN(rawPage) ? 1 : rawPage);
    const limit = Math.min(50, Math.max(1, Number.isNaN(rawLimit) ? 20 : rawLimit));
    const category = searchParams.get("category");
    const source = searchParams.get("source");
    const search = searchParams.get("search");
    const country = searchParams.get("country");

    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from("feed_items")
      .select("*", { count: "exact" })
      .eq("published", true)
      .order("source_created_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq("category", category);
    }
    if (source) {
      query = query.eq("source", source);
    }
    if (country) {
      query = query.eq("country_code", country.toUpperCase());
    }
    if (search) {
      // Full-text search using Postgres text search
      query = query.textSearch("title", search, { type: "websearch" });
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error("Feed query error", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch feed" },
        { status: 500 }
      );
    }

    const total = count ?? 0;

    return NextResponse.json(
      {
        items: data || [],
        total,
        page,
        limit,
        hasMore: offset + limit < total,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { items: [], total: 0, page: 1, limit: 20, hasMore: false },
      { status: 200 }
    );
  }
}
