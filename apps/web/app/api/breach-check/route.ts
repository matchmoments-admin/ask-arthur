import { NextResponse } from "next/server";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { checkHIBPDetailed } from "@askarthur/scam-engine/hibp";

/**
 * POST /api/breach-check
 * Proxies to HIBP API to check if an email has been in data breaches.
 * Backed by `checkHIBPDetailed` (Redis 24h cache + 5s timeout) — the route
 * used to fetch HIBP directly with no cache and no timeout, which meant
 * a slow HIBP response could pin the request indefinitely and repeated
 * checks for the same email burned the API quota.
 */
export async function POST(req: Request) {
  // Rate limit: 5/hour per IP
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimit = await checkFormRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: rateLimit.message ?? "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  // Parse request
  let email: string;
  try {
    const body = await req.json();
    email = body.email;
  } catch {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: "validation_error", message: "Email is required" },
      { status: 400 }
    );
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid email format" },
      { status: 400 }
    );
  }

  if (!process.env.HIBP_API_KEY) {
    logger.error("HIBP_API_KEY not configured");
    return NextResponse.json(
      { error: "service_unavailable", message: "Breach check is not available at this time" },
      { status: 503 }
    );
  }

  try {
    const result = await checkHIBPDetailed(email);
    return NextResponse.json(result);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    logger.error("Breach check failed", { error: String(err), timeout: isTimeout });
    return NextResponse.json(
      { error: "service_unavailable", message: "Breach check temporarily unavailable" },
      { status: 502 }
    );
  }
}
