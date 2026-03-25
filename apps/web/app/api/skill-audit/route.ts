import { NextRequest, NextResponse } from "next/server";
import { scanSkill } from "@askarthur/mcp-audit";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";

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

    // If skillId provided, fetch from ClawHub (GitHub-based)
    let content = skillContent;
    let name = skillName;

    if (skillId && !content) {
      // Normalize ClawHub skill ID to GitHub raw URL
      const cleanId = skillId.replace(/^clawhub\.ai\/skills\//, "");
      const rawUrl = `https://raw.githubusercontent.com/openclaw/clawhub/main/skills/${cleanId}/SKILL.md`;

      const res = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Could not fetch skill "${cleanId}" from ClawHub.` },
          { status: 404 }
        );
      }
      content = await res.text();
      name = name || cleanId;
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

    const result = await scanSkill({
      skillContent: content,
      skillName: name || "unknown",
    });

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
