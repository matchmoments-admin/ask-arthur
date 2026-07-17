import { NextRequest, NextResponse } from "next/server";
import { guardV1 } from "@/lib/v1-guard";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

// B2B / law-enforcement feed over image_check_records (image-check v2 PR 6,
// ADR-0022). A NEW route rather than an extension of /api/v1/deepfakes —
// that route is celebrity-shaped (trending monitored_celebrities); this one
// is the flagged-image-check stream regardless of who is depicted.
//
// Privacy contract: NEVER expose install_id_hash (correlatable) or the raw
// hive_result payload — only the curated metadata columns below. Inert-dark
// by construction: the table is empty until FF_IMAGE_CHECK_RECORDS is on.

const SELECT_COLUMNS =
  "check_ref, checked_at, image_url, page_url, image_sha256, ai_confidence, deepfake_confidence, generator_source, generator_breakdown, content_credentials, vision_summary, impersonated_brand, impersonated_celebrity";

function parsePeriodDays(period: string | null): number {
  if (!period) return 30;
  const match = period.match(/^(\d+)d$/);
  if (!match) return 30;
  const days = parseInt(match[1]!);
  return Math.min(Math.max(days, 1), 90);
}

function parseMinConfidence(raw: string | null): number | null {
  if (!raw) return null;
  const v = parseFloat(raw);
  if (Number.isNaN(v) || v < 0 || v > 1) return null;
  return v;
}

export async function GET(req: NextRequest) {
  const guard = await guardV1(req);
  if (!guard.ok) return guard.error;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const days = parsePeriodDays(searchParams.get("period"));
  const minConfidence = parseMinConfidence(searchParams.get("min_confidence"));
  const generator = searchParams.get("generator");
  const hasCelebrity = searchParams.get("has_celebrity") === "true";

  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    let query = supabase
      .from("image_check_records")
      .select(SELECT_COLUMNS)
      .gte("checked_at", since.toISOString())
      .order("checked_at", { ascending: false })
      .limit(100);

    if (minConfidence !== null) {
      // Match either signal clearing the bar — a deepfake with low
      // ai_generated (real photo, swapped face) must not be filtered out.
      query = query.or(
        `ai_confidence.gte.${minConfidence},deepfake_confidence.gte.${minConfidence}`,
      );
    }
    if (generator) {
      query = query.ilike("generator_source", `%${generator}%`);
    }
    if (hasCelebrity) {
      query = query.not("impersonated_celebrity", "is", null);
    }

    const { data: checks, error } = await query;
    if (error) {
      logger.error("Image-checks API query error", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch image-check data" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        meta: {
          period_days: days,
          filters: {
            min_confidence: minConfidence,
            generator: generator ?? null,
            has_celebrity: hasCelebrity || null,
          },
          total: checks?.length ?? 0,
          generated_at: new Date().toISOString(),
        },
        checks: checks ?? [],
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    logger.error("Image-checks API error", { error: String(err) });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
