import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@askarthur/supabase/middleware";
import { logger } from "@askarthur/utils/logger";

// Global edge rate limiting — 60 requests/min per IP (sliding window via Upstash)
// Coexists with per-route limits in lib/rateLimit.ts (defense-in-depth)

export async function middleware(req: NextRequest) {
  // Cron routes — defense-in-depth auth check before skipping rate limiting
  if (req.nextUrl.pathname.startsWith("/api/cron")) {
    const cronSecret = req.headers.get("x-cron-secret")
      ?? req.headers.get("authorization")?.replace("Bearer ", "");
    const expected = process.env.CRON_SECRET;

    if (!expected || !cronSecret || cronSecret.length !== expected.length) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Timing-safe comparison
    const encoder = new TextEncoder();
    const a = encoder.encode(cronSecret);
    const b = encoder.encode(expected);
    let mismatch = a.length !== b.length ? 1 : 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      mismatch |= a[i] ^ b[i];
    }
    if (mismatch !== 0) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.next();
  }

  // ---------------------------------------------------------------------------
  // 1. Session refresh — refresh expired tokens on every request
  //    Required by @supabase/ssr to keep auth cookies fresh.
  // ---------------------------------------------------------------------------
  const authEnabled = process.env.NEXT_PUBLIC_FF_AUTH === "true";
  const { supabase, response } = createMiddlewareClient(req);

  if (authEnabled && supabase) {
    // getUser() validates JWT server-side (not spoofable like getSession)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const pathname = req.nextUrl.pathname;

    // -------------------------------------------------------------------------
    // 2. Route protection: /app/* — require authenticated user
    // -------------------------------------------------------------------------
    if (pathname.startsWith("/app")) {
      if (!user) {
        const loginUrl = req.nextUrl.clone();
        loginUrl.pathname = "/login";
        loginUrl.searchParams.set("next", pathname);
        return NextResponse.redirect(loginUrl);
      }
    }

    // -------------------------------------------------------------------------
    // 3. Route protection: /admin/* — require admin role
    //    (except /admin/login which uses its own HMAC auth)
    // -------------------------------------------------------------------------
    if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
      if (!user) {
        const loginUrl = req.nextUrl.clone();
        loginUrl.pathname = "/login";
        return NextResponse.redirect(loginUrl);
      }
      if (user.app_metadata?.role !== "admin") {
        // Non-admin user — fall through to existing HMAC admin auth
        // (dual-mode during transition, don't block here)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Rate limiting — only API routes and mutating requests
  // ---------------------------------------------------------------------------
  const isApiRoute = req.nextUrl.pathname.startsWith("/api/");
  const isMutatingRequest = req.method !== "GET" && req.method !== "HEAD";
  if (!isApiRoute && !isMutatingRequest) {
    return response;
  }

  // Fail-open in dev when Upstash not configured
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    if (process.env.NODE_ENV === "production") {
      logger.error("Upstash not configured in production — blocking request");
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }
    return response;
  }

  const ip =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";

  try {
    // Upstash REST API sliding window — avoid importing full SDK in edge runtime
    const now = Date.now();
    const windowMs = 60_000; // 1 minute
    const maxRequests = 60;
    const key = `askarthur:global:${ip}`;

    // Use Upstash Redis REST API directly for edge compatibility
    const redisResponse = await fetch(`${redisUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        // Remove expired entries
        ["ZREMRANGEBYSCORE", key, "0", String(now - windowMs)],
        // Add current request
        ["ZADD", key, String(now), `${now}:${Math.random()}`],
        // Count requests in window
        ["ZCARD", key],
        // Set TTL on the key
        ["PEXPIRE", key, String(windowMs)],
      ]),
    });

    if (!redisResponse.ok) {
      // Fail-open on Redis errors to avoid blocking legitimate traffic
      logger.error("Middleware Upstash error", { status: redisResponse.status });
      return response;
    }

    const results = await redisResponse.json();
    const requestCount = results[2]?.result ?? 0;

    if (requestCount > maxRequests) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": String(maxRequests),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    response.headers.set("X-RateLimit-Limit", String(maxRequests));
    response.headers.set(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxRequests - requestCount))
    );
    return response;
  } catch (err) {
    // Fail-open on unexpected errors
    logger.error("Middleware rate limit error", { error: String(err) });
    return response;
  }
}

export const config = {
  matcher: [
    // Match all routes except static files, images, favicon
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
