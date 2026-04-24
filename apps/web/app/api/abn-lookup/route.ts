import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { lookupABN } from "@/lib/abnLookup";

const ABNParamSchema = z.string().regex(/^\d{11}$/, "ABN must be exactly 11 digits");

let _limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_limiter) {
    _limiter = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(10, "1 h"),
      prefix: "askarthur:abn-lookup",
    });
  }
  return _limiter;
}

export async function GET(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-real-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";

    const limiter = getLimiter();
    if (limiter) {
      const result = await limiter.limit(ip);
      if (!result.success) {
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429 }
        );
      }
    } else if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Service temporarily unavailable." },
        { status: 503 }
      );
    }

    const abn = req.nextUrl.searchParams.get("abn") ?? "";
    const parsed = ABNParamSchema.safeParse(abn);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid ABN" },
        { status: 400 }
      );
    }

    const result = await lookupABN(parsed.data);

    if (!result) {
      return NextResponse.json(
        { error: "ABN not found or lookup unavailable" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
