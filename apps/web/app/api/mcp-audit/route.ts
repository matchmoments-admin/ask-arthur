import { NextRequest, NextResponse } from "next/server";
import { scanMcpServer } from "@askarthur/mcp-audit";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";

const PACKAGE_NAME_RE = /^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9._-]+$/;

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    const rl = await checkRateLimit(ip, ua);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: rl.message || "Too many requests." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { packageName } = body;

    if (!packageName || !PACKAGE_NAME_RE.test(packageName)) {
      return NextResponse.json(
        { error: "Invalid package name." },
        { status: 400 }
      );
    }

    const result = await scanMcpServer({ packageName });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    logger.error("MCP audit failed", { error: String(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
