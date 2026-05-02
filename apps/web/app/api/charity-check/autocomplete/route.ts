import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Redis } from "@upstash/redis";

import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { checkCharityCheckRateLimit } from "@askarthur/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 8 results per response — matches the search_charities RPC default.
const MAX_LIMIT = 8;
// 1-hour cache per query string; charity register changes weekly.
const CACHE_TTL_SECONDS = 60 * 60;

const QuerySchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

interface SearchRow {
  abn: string;
  charity_legal_name: string;
  town_city: string | null;
  state: string | null;
  charity_website: string | null;
  similarity_score: number;
}

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

export async function GET(req: NextRequest) {
  if (!featureFlags.charityCheck) {
    return NextResponse.json(
      { error: { code: "feature_disabled", message: "Charity Check is not enabled in this environment." } },
      { status: 503 },
    );
  }

  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const rate = await checkCharityCheckRateLimit("cc_autocomplete", ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: rate.message ?? "Too many requests. Please try again later." } },
      { status: 429 },
    );
  }

  const parsed = QuerySchema.safeParse({
    q: req.nextUrl.searchParams.get("q") ?? "",
    limit: req.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_input",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      },
      { status: 400 },
    );
  }

  const q = parsed.data.q.trim();
  const limit = parsed.data.limit ?? MAX_LIMIT;
  const cacheKey = `askarthur:cc:autocomplete:v1:${limit}:${q.toLowerCase()}`;

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<SearchRow[]>(cacheKey);
      if (cached) {
        return NextResponse.json(
          { results: cached, cached: true },
          { headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` } },
        );
      }
    } catch (err) {
      logger.warn("autocomplete redis read failed", { error: String(err) });
    }
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: { code: "service_unavailable", message: "Charity register temporarily unavailable." } },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.rpc("search_charities", {
    p_query: q,
    p_limit: limit,
  });

  if (error) {
    logger.warn("autocomplete RPC failed", { error: error.message });
    return NextResponse.json(
      { error: { code: "search_failed", message: "Charity search failed. Please try again." } },
      { status: 500 },
    );
  }

  const results = (data ?? []) as SearchRow[];

  if (redis) {
    redis
      .set(cacheKey, results, { ex: CACHE_TTL_SECONDS })
      .catch((err) => logger.warn("autocomplete redis write failed", { error: String(err) }));
  }

  return NextResponse.json(
    { results, cached: false },
    { headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` } },
  );
}
