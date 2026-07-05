import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@askarthur/supabase/middleware";
import { logger } from "@askarthur/utils/logger";
import { getLogger } from "@askarthur/utils/axiom-logger";
import { resolveRequestId } from "@askarthur/utils/request-id";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { verifyAdminToken, COOKIE_NAME as ADMIN_COOKIE } from "@/lib/adminAuth";

// First-touch attribution cookie. Captured once on the visitor's FIRST landing
// and never overwritten, so a later organic return doesn't clobber the paid /
// LinkedIn first-touch. Read server-side by logEvent() (httpOnly — client JS
// can't see it) to stamp every conversion with the channel that produced it.
const ATTRIBUTION_COOKIE = "aa_attribution";
const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 90; // 90 days
const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

// Set the aa_attribution cookie on `res` if the visitor doesn't already have
// one (first-touch guard). No-op unless FF_ANALYTICS_ATTRIBUTION is on. Cheap
// and side-effect-free — deliberately does NOT touch Supabase; the visitors
// row is upserted lazily from the event-write path, never from middleware
// (a DB write here would reintroduce the 2026-05-09 timeout class).
function maybeSetAttribution(req: NextRequest, res: NextResponse): void {
  if (!featureFlags.analyticsAttribution) return;
  // /go/* short links are clean (no UTM query), so capturing here would record
  // an empty first-touch and the guard would then ignore the destination's
  // UTMs. The /go route is the sole authority for those — it bakes the slug's
  // UTMs into the cookie itself.
  if (req.nextUrl.pathname.startsWith("/go/")) return;
  if (req.cookies.has(ATTRIBUTION_COOKIE)) return;
  try {
    const sp = req.nextUrl.searchParams;
    const utm: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = sp.get(k);
      if (v) utm[k] = v;
    }
    const payload = {
      ...utm,
      referrer: req.headers.get("referer") ?? "",
      landing_path: req.nextUrl.pathname,
      anonymous_id: crypto.randomUUID(),
      ts: new Date().toISOString(),
    };
    res.cookies.set(ATTRIBUTION_COOKIE, JSON.stringify(payload), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // sent on top-level cross-site arrivals from a link/ad
      path: "/",
      maxAge: ATTRIBUTION_MAX_AGE,
    });
  } catch {
    // Never let attribution capture break a request.
  }
}

// Global edge rate limiting — 60 requests/min per IP (sliding window via Upstash)
// Coexists with per-route limits in lib/rateLimit.ts (defense-in-depth)

// Race a promise against a timeout. Returns null on timeout. Used to keep a
// degraded Supabase Auth from taking the whole site down via a hung
// middleware invocation (incident 2026-05-09).
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T | null> {
  return await Promise.race([
    p,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        logger.error(`${label} timed out after ${ms}ms`);
        resolve(null);
      }, ms),
    ),
  ]);
}

export async function middleware(req: NextRequest) {
  const start = Date.now();

  // Compute a canonical request id once per request and propagate it as
  // (a) the `x-request-id` request header so downstream route handlers
  // share it, and (b) the `X-Request-Id` response header so clients can
  // correlate. `resolveRequestId` already evaluates Idempotency-Key
  // precedence; we feed it the inbound headers so the priority order
  // stays in one place. `requestHeaders` is what supabase's middleware
  // helper will use when building the response.
  const requestId = resolveRequestId(req.headers);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);

  // Inngest webhook — authenticated by Inngest's signing key inside the
  // route handler (`serve()` from `inngest/next` validates X-Inngest-
  // Signature using `INNGEST_SIGNING_KEY`). The middleware's Supabase
  // auth path is incompatible: Inngest doesn't send user cookies, so
  // `supabase.auth.getUser()` runs with no JWT and stalls for 3s when
  // Supabase Auth is degraded, causing Inngest to mark the webhook
  // delivery as failed (smoke-test 2026-05-26 — none of the new
  // clone-watch outreach fns processed events until this skip landed).
  // Same shape as the cron skip below.
  if (req.nextUrl.pathname.startsWith("/api/inngest")) {
    const skipResponse = NextResponse.next({ request: { headers: requestHeaders } });
    skipResponse.headers.set("X-Request-Id", requestId);
    return skipResponse;
  }

  // Cron routes — defense-in-depth auth check before skipping rate limiting
  if (req.nextUrl.pathname.startsWith("/api/cron")) {
    const cronSecret = req.headers.get("x-cron-secret")
      ?? req.headers.get("authorization")?.replace("Bearer ", "");
    const expected = process.env.CRON_SECRET;

    if (!expected || !cronSecret || cronSecret.length !== expected.length) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "X-Request-Id": requestId } },
      );
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
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "X-Request-Id": requestId } },
      );
    }

    const cronResponse = NextResponse.next({ request: { headers: requestHeaders } });
    cronResponse.headers.set("X-Request-Id", requestId);
    return cronResponse;
  }

  // ---------------------------------------------------------------------------
  // 1. Session refresh — refresh expired tokens on every request
  //    Required by @supabase/ssr to keep auth cookies fresh.
  // ---------------------------------------------------------------------------
  const authEnabled = process.env.NEXT_PUBLIC_FF_AUTH === "true";
  const { supabase, response } = createMiddlewareClient(req, requestHeaders);

  // First-touch attribution — set on the shared `response`, which is what every
  // normal exit returns (including the non-API GET page-load short-circuit
  // below, i.e. the actual "arrival from LinkedIn" path). Redirect / 401 / 429
  // early-return responses are auth/machine paths, not first touches, so they
  // don't need it. Guarded + first-touch-safe inside the helper.
  maybeSetAttribution(req, response);
  let authState: "auth_disabled" | "anonymous" | "user" | "admin" =
    authEnabled ? "anonymous" : "auth_disabled";

  if (authEnabled && supabase) {
    // getUser() validates JWT server-side (not spoofable like getSession).
    // Wrapped in a 3s timeout so a degraded Supabase Auth can't hang the
    // whole middleware invocation. On timeout we treat the request as
    // anonymous — public pages stay up; protected paths redirect to login.
    const result = await withTimeout(
      supabase.auth.getUser(),
      3000,
      "middleware: supabase.auth.getUser",
    );
    const user = result?.data?.user ?? null;
    if (user) {
      authState = user.app_metadata?.role === "admin" ? "admin" : "user";
    }

    const pathname = req.nextUrl.pathname;

    // -------------------------------------------------------------------------
    // 2. Route protection: /app/* — require authenticated user
    // -------------------------------------------------------------------------
    if (pathname.startsWith("/app")) {
      if (!user) {
        const loginUrl = req.nextUrl.clone();
        loginUrl.pathname = "/login";
        loginUrl.searchParams.set("next", pathname);
        const redirectResponse = NextResponse.redirect(loginUrl);
        redirectResponse.headers.set("X-Request-Id", requestId);
        return redirectResponse;
      }
    }

    // -------------------------------------------------------------------------
    // 3. Route protection: /admin/* — require admin role
    //    (except /admin/login which uses its own HMAC auth)
    // -------------------------------------------------------------------------
    if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
      if (!user) {
        // Dual-auth: check the HMAC admin cookie before bouncing to /login.
        // The /api/admin/login route is the canonical secret-only flow;
        // requireAdmin() in route handlers accepts the HMAC cookie even when
        // Supabase Auth is enabled. Middleware previously only checked the
        // Supabase user and redirected HMAC-only admins to the consumer
        // /login page — caught 2026-05-27 during the PR #459 live e2e test.
        const adminCookie = req.cookies.get(ADMIN_COOKIE)?.value;
        if (!adminCookie || !verifyAdminToken(adminCookie)) {
          const loginUrl = req.nextUrl.clone();
          loginUrl.pathname = "/admin/login";
          const redirectResponse = NextResponse.redirect(loginUrl);
          redirectResponse.headers.set("X-Request-Id", requestId);
          return redirectResponse;
        }
        // HMAC-authenticated — fall through.
        authState = "admin";
      } else if (user.app_metadata?.role !== "admin") {
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
    response.headers.set("X-Request-Id", requestId);
    logRequest(response, 0);
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
        { status: 503, headers: { "X-Request-Id": requestId } }
      );
    }
    response.headers.set("X-Request-Id", requestId);
    logRequest(response, 0);
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
      response.headers.set("X-Request-Id", requestId);
      logRequest(response, undefined);
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
            "X-Request-Id": requestId,
          },
        }
      );
    }

    const remaining = Math.max(0, maxRequests - requestCount);
    response.headers.set("X-RateLimit-Limit", String(maxRequests));
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-Request-Id", requestId);
    logRequest(response, remaining);
    return response;
  } catch (err) {
    // Fail-open on unexpected errors
    logger.error("Middleware rate limit error", { error: String(err) });
    response.headers.set("X-Request-Id", requestId);
    logRequest(response, undefined);
    return response;
  }

  // Emit one sampled Axiom INFO per request. Fire-and-forget: do NOT
  // await flush. Middleware sits in the hot path of every page request,
  // and a network round-trip to api.axiom.co per request would tax page
  // load. The wrapper is a no-op until FF_AXIOM_ENABLED=true.
  function logRequest(res: NextResponse, rateRemaining: number | undefined): void {
    try {
      const log = getLogger({ source: "middleware", requestId });
      const fields = {
        method: req.method,
        path: req.nextUrl.pathname,
        status: res.status,
        authState,
        durationMs: Date.now() - start,
        rateRemaining,
      };
      // Level by status so server errors are never sampled away: INFO is
      // 10%-sampled in prod (axiom-logger), so a 5xx logged at info has only a
      // ~10% chance of landing — useless for catching outages. WARN/ERROR
      // always ship. 5xx → error (real server fault, also drives the
      // axiom-fleet-watch 5xx-spike alert); 429 → warn (rate-limit pressure
      // worth seeing unsampled); everything else stays info/sampled.
      if (res.status >= 500) {
        log.error("request", fields);
      } else if (res.status === 429) {
        log.warn("request", fields);
      } else {
        log.info("request", fields);
      }
      // Fire-and-forget — neutralise rejection so a flaky Axiom can't
      // surface as an unhandled-rejection runtime warning.
      log.flush().catch(() => {});
    } catch {
      // Never let logging break a request.
    }
  }
}

export const config = {
  matcher: [
    // Match all routes except static files, images, favicon
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
  // Node.js runtime — required because PR #461 added verifyAdminToken
  // (which uses node:crypto's createHmac + timingSafeEqual) to the
  // /admin/* path of this middleware. In Edge Runtime, the polyfilled
  // crypto silently returns mismatched digests for valid HMACs, so every
  // HMAC-only admin login got 307'd back to /admin/login despite a
  // mathematically-valid cookie. Caught 2026-05-27 during the live e2e
  // test (server returned 307 even when curl'd with a hand-verified
  // valid cookie + matching prod ADMIN_SECRET).
  //
  // Next.js 16 supports Node.js middleware natively (no experimental
  // flag). Per Vercel's platform guidance, Node.js middleware is the
  // recommended runtime — it runs on Fluid Compute with the same cold-
  // start characteristics as Edge for routine requests.
  runtime: "nodejs",
};
