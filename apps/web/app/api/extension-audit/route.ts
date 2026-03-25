import { NextRequest, NextResponse } from "next/server";
import { scanExtension } from "@askarthur/extension-audit";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";

const EXTENSION_ID_RE = /^[a-z]{32}$/;

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    const rl = await checkRateLimit(ip, ua);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: rl.message || "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { extensionId } = body;

    if (!extensionId || !EXTENSION_ID_RE.test(extensionId)) {
      return NextResponse.json(
        { error: "Invalid extension ID. Must be 32 lowercase alphanumeric characters." },
        { status: 400 }
      );
    }

    const result = await scanExtension({ extensionId });

    // Persist to database (fire-and-forget)
    const supabase = createServiceClient();
    if (supabase) {
      supabase.rpc("upsert_scan_result", {
        p_scan_type: "extension",
        p_target: extensionId,
        p_target_display: result.targetDisplay,
        p_overall_score: result.overallScore,
        p_grade: result.grade,
        p_result: result,
      }).then(({ data, error }) => {
        if (error) logger.error("Failed to store extension scan", { error: error.message });
        if (data) {
          const row = typeof data === "string" ? JSON.parse(data) : Array.isArray(data) ? data[0] : data;
          if (row?.share_token) result.shareToken = row.share_token;
        }
      });
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (err) {
    logger.error("Extension audit failed", { error: String(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
