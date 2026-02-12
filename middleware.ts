import { NextRequest, NextResponse } from "next/server";

// Global edge rate limiting — 60 requests/min per IP (sliding window via Upstash)
// Coexists with per-route limits in lib/rateLimit.ts (defense-in-depth)

export async function middleware(req: NextRequest) {
  // Skip cron routes (authenticated separately via CRON_SECRET)
  if (req.nextUrl.pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  // Fail-open in dev when Upstash not configured
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    if (process.env.NODE_ENV === "production") {
      console.error("[CRITICAL] Upstash not configured in production — blocking request");
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }
    return NextResponse.next();
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
    const response = await fetch(`${redisUrl}/pipeline`, {
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

    if (!response.ok) {
      // Fail-open on Redis errors to avoid blocking legitimate traffic
      console.error("[middleware] Upstash error:", response.status);
      return NextResponse.next();
    }

    const results = await response.json();
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

    const res = NextResponse.next();
    res.headers.set("X-RateLimit-Limit", String(maxRequests));
    res.headers.set(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxRequests - requestCount))
    );
    return res;
  } catch (err) {
    // Fail-open on unexpected errors
    console.error("[middleware] Rate limit error:", err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Match all routes except static files, images, favicon
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
