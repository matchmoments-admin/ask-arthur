import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { scanSkill } from "@askarthur/mcp-audit";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";

const SKILL_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const GITHUB_PREFIX = "github:";
const GITHUB_REPO_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

/** Try to fetch a skill definition file from a GitHub repo.
 *  Tries main then master branch; tries SKILL.md, skill.md, then README.md. */
async function fetchSkillFromGithub(owner: string, repo: string): Promise<{ content: string; filename: string } | null> {
  const branches = ["main", "master"];
  const filenames = ["SKILL.md", "skill.md", "README.md"];

  for (const branch of branches) {
    for (const filename of filenames) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const content = await res.text();
          if (content && content.length > 0) {
            return { content, filename };
          }
        }
      } catch {
        // Network error — try next combination
      }
    }
  }

  return null;
}

interface ClawHubSkillResponse {
  skill: {
    slug: string;
    displayName: string;
    summary: string;
    tags: { latest: string };
    stats: { downloads: number; installsAllTime: number; stars: number };
  };
  latestVersion: { version: string };
  owner: { handle: string; displayName: string };
  moderation: unknown;
}

interface ClawHubVersionResponse {
  version: { version: string };
  files: Array<{ path: string; size: number; sha256: string }>;
  security: {
    status: string;
    hasWarnings: boolean;
    scanners?: {
      vt?: { status: string; verdict: string; analysis: string };
      llm?: { status: string; verdict: string; summary: string; guidance: string };
    };
  };
}

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
      // ── GitHub repo skill scan ──
      if (skillId.startsWith(GITHUB_PREFIX)) {
        const repoPath = skillId.slice(GITHUB_PREFIX.length);
        if (!GITHUB_REPO_RE.test(repoPath)) {
          return NextResponse.json({ error: "Invalid GitHub repository format. Expected owner/repo." }, { status: 400 });
        }

        const [owner, repo] = repoPath.split("/");
        name = name || repo;

        try {
          const fetched = await fetchSkillFromGithub(owner, repo);
          if (!fetched) {
            return NextResponse.json(
              { error: `Could not find SKILL.md or README.md in ${owner}/${repo}. Tried main and master branches.` },
              { status: 404 }
            );
          }

          content = fetched.content;

          if (content.length > 500_000) {
            return NextResponse.json({ error: "Skill content too large (max 500KB)." }, { status: 400 });
          }

          const result = await scanSkill({ skillContent: content, skillName: name });

          // Enrich meta with GitHub source info
          result.meta = {
            ...result.meta,
            source: "github",
            githubRepo: `${owner}/${repo}`,
            sourceFile: fetched.filename,
          };

          result.target = `${owner}/${repo}`;
          result.targetDisplay = `${owner}/${repo}`;

          // Persist (fire-and-forget)
          const supabase = createServiceClient();
          if (supabase) {
            supabase.rpc("upsert_scan_result", {
              p_scan_type: "skill",
              p_target: `github:${owner}/${repo}`,
              p_target_display: `${owner}/${repo}`,
              p_overall_score: result.overallScore,
              p_grade: result.grade,
              p_result: result,
            }).then(({ error }) => {
              if (error) logger.error("Failed to store GitHub skill scan", { error: error.message });
            });
          }

          return NextResponse.json(result, {
            headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
          });
        } catch (fetchErr) {
          return NextResponse.json(
            { error: `Could not fetch from GitHub: ${fetchErr instanceof Error ? fetchErr.message : "network error"}` },
            { status: 502 }
          );
        }
      }

      // ── ClawHub skill scan ──
      // Clean the slug — strip @scope/skill- prefix, clawhub.ai/skills/ prefix
      const cleanSlug = skillId
        .replace(/^@[^/]+\/skill-/, "")
        .replace(/^clawhub\.ai\/skills\//, "")
        .replace(/\//g, "");

      if (!SKILL_SLUG_RE.test(cleanSlug)) {
        return NextResponse.json({ error: "Invalid skill ID format." }, { status: 400 });
      }

      // Fetch from ClawHub API (not GitHub)
      try {
        const [metaRes, versionRes] = await Promise.all([
          fetch(`https://clawhub.ai/api/v1/skills/${cleanSlug}`, { signal: AbortSignal.timeout(10000) }),
          fetch(`https://clawhub.ai/api/v1/skills/${cleanSlug}/versions/latest`, { signal: AbortSignal.timeout(10000) }),
        ]);

        if (!metaRes.ok) {
          return NextResponse.json(
            { error: `Skill "${cleanSlug}" not found on ClawHub (${metaRes.status}).` },
            { status: 404 }
          );
        }

        const meta: ClawHubSkillResponse = await metaRes.json();
        const version: ClawHubVersionResponse | null = versionRes.ok ? await versionRes.json() : null;
        name = meta.skill.displayName || cleanSlug;

        // Download actual SKILL.md content from ClawHub ZIP endpoint
        const downloadUrl = `https://clawhub.ai/api/v1/download?slug=${cleanSlug}`;
        const dlRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(15000) });

        if (dlRes.ok) {
          const zipBuffer = await dlRes.arrayBuffer();
          const zip = await JSZip.loadAsync(zipBuffer);
          const skillFile = zip.file("SKILL.md");
          if (skillFile) {
            content = await skillFile.async("text");
          }
        }

        // Fallback: build from metadata if download failed
        if (!content) {
          content = [
            `---`,
            `name: ${meta.skill.slug}`,
            `description: ${meta.skill.summary || ""}`,
            `---`,
            `# ${meta.skill.displayName}`,
            ``,
            meta.skill.summary || "",
          ].join("\n");
        }

        // Run our scan on the metadata
        const result = await scanSkill({ skillContent: content, skillName: name });

        // Enrich with ClawHub's own security assessment
        if (version?.security) {
          const chSecurity = version.security;
          result.meta = {
            ...result.meta,
            clawhubSecurityStatus: chSecurity.status,
            clawhubHasWarnings: chSecurity.hasWarnings,
            clawhubVtVerdict: chSecurity.scanners?.vt?.verdict,
            clawhubLlmVerdict: chSecurity.scanners?.llm?.verdict,
            clawhubLlmSummary: chSecurity.scanners?.llm?.summary,
            clawhubGuidance: chSecurity.scanners?.llm?.guidance,
            owner: meta.owner.handle,
            downloads: meta.skill.stats.downloads,
            installs: meta.skill.stats.installsAllTime,
            stars: meta.skill.stats.stars,
            version: meta.skill.tags.latest,
          };

          // Add ClawHub's security assessment as a check
          const vtClean = chSecurity.scanners?.vt?.status === "clean";
          const llmClean = chSecurity.scanners?.llm?.status === "clean";

          result.checks.push({
            id: "SKILL-CH-VT",
            category: "metadata",
            label: "ClawHub VirusTotal scan",
            status: vtClean ? "pass" : "warn",
            score: vtClean ? 5 : 0,
            maxScore: 5,
            details: vtClean
              ? "VirusTotal scan: clean"
              : `VirusTotal scan: ${chSecurity.scanners?.vt?.verdict || "unknown"}`,
          });

          result.checks.push({
            id: "SKILL-CH-LLM",
            category: "metadata",
            label: "ClawHub AI security review",
            status: llmClean ? "pass" : chSecurity.scanners?.llm?.status === "suspicious" ? "warn" : "fail",
            score: llmClean ? 5 : 2,
            maxScore: 5,
            details: chSecurity.scanners?.llm?.summary || "No AI review available.",
          });
        }

        // Persist
        const supabase = createServiceClient();
        if (supabase) {
          supabase.rpc("upsert_scan_result", {
            p_scan_type: "skill",
            p_target: cleanSlug,
            p_target_display: name,
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

      } catch (fetchErr) {
        return NextResponse.json(
          { error: `Could not reach ClawHub: ${fetchErr instanceof Error ? fetchErr.message : "network error"}` },
          { status: 502 }
        );
      }
    }

    // Direct content submission (raw SKILL.md paste)
    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Provide skillContent (raw SKILL.md) or skillId (ClawHub slug)." },
        { status: 400 }
      );
    }

    if (content.length > 500_000) {
      return NextResponse.json({ error: "Skill content too large (max 500KB)." }, { status: 400 });
    }

    const result = await scanSkill({ skillContent: content, skillName: name || "unknown" });

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
