import { NextRequest, NextResponse } from "next/server";
import { scanSkill } from "@askarthur/mcp-audit";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";

const SKILL_ID_RE = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?$/;

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    const rl = await checkRateLimit(ip, ua);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.message || "Too many requests." }, { status: 429 });
    }

    const body = await req.json();
    const { skillContent, skillName, skillId } = body;

    let content = skillContent;
    let name = skillName;

    if (skillId && !content) {
      const cleanId = skillId.replace(/^clawhub\.ai\/skills\//, "");

      if (!SKILL_ID_RE.test(cleanId)) {
        return NextResponse.json(
          { error: "Invalid skill ID format." },
          { status: 400 }
        );
      }

      const rawUrl = `https://raw.githubusercontent.com/openclaw/clawhub/main/skills/${cleanId}/SKILL.md`;

      try {
        const res = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
          return NextResponse.json(
            { error: `Skill "${cleanId}" not found on ClawHub (${res.status}).` },
            { status: 404 }
          );
        }
        content = await res.text();
        name = name || cleanId;
      } catch (fetchErr) {
        return NextResponse.json(
          { error: `Could not fetch skill from ClawHub: ${fetchErr instanceof Error ? fetchErr.message : "network error"}` },
          { status: 502 }
        );
      }
    }

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Provide skillContent (raw SKILL.md) or skillId (ClawHub reference)." },
        { status: 400 }
      );
    }

    if (content.length > 500_000) {
      return NextResponse.json({ error: "Skill content too large (max 500KB)." }, { status: 400 });
    }

    const result = await scanSkill({ skillContent: content, skillName: name || "unknown" });

    // Persist (fire-and-forget)
    const supabase = createServiceClient();
    if (supabase) {
      supabase.rpc("upsert_scan_result", {
        p_scan_type: "skill",
        p_target: name || "unknown",
        p_target_display: result.targetDisplay,
        p_overall_score: result.overallScore,
        p_grade: result.grade,
        p_result: result,
      }).then(({ error }) => {
        if (error) logger.error("Failed to store skill scan", { error: error.message });
      });
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (err) {
    logger.error("Skill audit failed", { error: String(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
