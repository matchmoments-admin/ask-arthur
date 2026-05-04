import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Redis } from "@upstash/redis";
import { checkRateLimit } from "@askarthur/utils/rate-limit";
import { resolveRequestId } from "@askarthur/utils/request-id";
import { logger } from "@askarthur/utils/logger";
import { ipAddress } from "@vercel/functions";
import { getSimilarReports } from "@askarthur/scam-engine/retrieval/similar-reports";

export const runtime = "nodejs";

/**
 * POST /api/analyze/similar
 *
 * Two-stage retrieval over scam_reports for the post-verdict surface
 * "12 Australians reported similar messages this week". Hybrid (BM25 ∪ dense)
 * → RRF top 50 → voyage rerank-2.5-lite → top 5 ≥ 0.4 relevance.
 *
 * Called by the result page AFTER /api/analyze returns its verdict — kept
 * separate so verdict latency doesn't depend on retrieval. Cached by SHA-256
 * of the input text for 1h so repeated views of the same submission don't
 * burn Voyage budget.
 *
 * Surface budget: ~$0.0002/uncached call. Rate-limited via the standard
 * checkRateLimit so abuse can't drive cost. Returns [] gracefully when
 * upstream (Supabase / Voyage) is unavailable rather than 5xx-ing — the
 * surface is decorative, not load-bearing.
 */

const RequestSchema = z.object({
  text: z.string().min(1).max(50_000),
});

const SIMILAR_CACHE_TTL_SECONDS = 60 * 60; // 1h
const SIMILAR_CACHE_PREFIX = "askarthur:analyze:similar";

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractClientIp(req: NextRequest): string | null {
  const vercelIp = ipAddress(req);
  if (vercelIp) return vercelIp;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  const requestId = resolveRequestId(req.headers);

  const ip = extractClientIp(req);
  if (!ip && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "bad_request", message: "Could not identify client." },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }
  const clientIp = ip ?? "127.0.0.1";
  const ua = req.headers.get("user-agent") || "unknown";

  const rateCheck = await checkRateLimit(clientIp, ua);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: rateCheck.message },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-Request-Id": requestId,
          "Retry-After": rateCheck.resetAt
            ? String(Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 1000))
            : "3600",
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid JSON" },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", message: parsed.error.issues[0]?.message },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const { text } = parsed.data;
  const textHash = (await sha256Hex(text)).slice(0, 32);
  const cacheKey = `${SIMILAR_CACHE_PREFIX}:${textHash}`;

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<{ reports: unknown[] }>(cacheKey);
      if (cached) {
        return NextResponse.json(
          { reports: cached.reports, cached: true, requestId },
          { headers: { "X-Request-Id": requestId } },
        );
      }
    } catch (err) {
      logger.warn("similar-reports cache get failed", {
        requestId,
        error: String(err),
      });
    }
  }

  try {
    const reports = await getSimilarReports(text, { requestId });

    if (redis) {
      // Fire-and-forget cache write. Don't await so Voyage cost is paid
      // even if Redis is degraded.
      redis
        .set(cacheKey, { reports }, { ex: SIMILAR_CACHE_TTL_SECONDS })
        .catch((err) =>
          logger.warn("similar-reports cache set failed", {
            requestId,
            error: String(err),
          }),
        );
    }

    return NextResponse.json(
      { reports, cached: false, requestId },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    // Decorative surface — log and return empty rather than 5xx-ing the
    // result page. The verdict UX is unaffected.
    logger.error("similar-reports retrieval failed", {
      requestId,
      error: String(err),
    });
    return NextResponse.json(
      { reports: [], cached: false, requestId, error: "retrieval_failed" },
      { headers: { "X-Request-Id": requestId } },
    );
  }
}
