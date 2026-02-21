import { NextResponse } from "next/server";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";

const HIBP_API_BASE = "https://haveibeenpwned.com/api/v3";

interface BreachInfo {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  DataClasses: string[];
}

/**
 * POST /api/breach-check
 * Proxies to HIBP API to check if an email has been in data breaches.
 * Keeps the HIBP API key server-side.
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

  const apiKey = process.env.HIBP_API_KEY;
  if (!apiKey) {
    logger.error("HIBP_API_KEY not configured");
    return NextResponse.json(
      { error: "service_unavailable", message: "Breach check is not available at this time" },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(
      `${HIBP_API_BASE}/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      {
        headers: {
          "hibp-api-key": apiKey,
          "user-agent": "AskArthur-ScamChecker",
        },
      }
    );

    // 404 = no breaches found
    if (response.status === 404) {
      return NextResponse.json({
        breached: false,
        breachCount: 0,
        breaches: [],
      });
    }

    if (!response.ok) {
      logger.error("HIBP API error", { status: response.status });
      return NextResponse.json(
        { error: "service_unavailable", message: "Breach check temporarily unavailable" },
        { status: 502 }
      );
    }

    const data: BreachInfo[] = await response.json();

    return NextResponse.json({
      breached: true,
      breachCount: data.length,
      breaches: data.map((b) => ({
        name: b.Name,
        title: b.Title,
        domain: b.Domain,
        date: b.BreachDate,
        dataTypes: b.DataClasses,
      })),
    });
  } catch (err) {
    logger.error("Breach check failed", { error: String(err) });
    return NextResponse.json(
      { error: "service_unavailable", message: "Breach check temporarily unavailable" },
      { status: 502 }
    );
  }
}
