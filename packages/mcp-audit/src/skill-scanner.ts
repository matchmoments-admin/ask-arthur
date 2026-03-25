// OpenClaw / Claude Code skill scanner — analyzes SKILL.md files for
// prompt injection, malicious code, AMOS indicators, and supply chain risks.

import type { ScanCheck, ScanCategory, ScanRecommendation, UnifiedScanResult } from "@askarthur/types/scanner";
import { calculateGrade } from "@askarthur/types/scanner";
import {
  INJECTION_PATTERNS,
  OBFUSCATION_PATTERNS,
  SECRET_PATTERNS,
  EXFIL_PATTERNS,
  KNOWN_C2_INDICATORS,
  detectTyposquatting,
} from "./patterns";

type SkillCheckCategory =
  | "prompt_injection"
  | "malicious_code"
  | "amos_indicators"
  | "suspicious_downloads"
  | "credentials"
  | "content_exposure"
  | "metadata";

const CATEGORY_CONFIG: Record<SkillCheckCategory, { label: string; weight: number }> = {
  prompt_injection: { label: "Prompt Injection", weight: 0.25 },
  malicious_code: { label: "Malicious Code", weight: 0.25 },
  amos_indicators: { label: "Malware Indicators", weight: 0.15 },
  suspicious_downloads: { label: "Suspicious Downloads", weight: 0.15 },
  credentials: { label: "Credential Handling", weight: 0.10 },
  content_exposure: { label: "Content Exposure", weight: 0.05 },
  metadata: { label: "Metadata Validation", weight: 0.05 },
};

// ── Download patterns ──

const URL_SHORTENER_RE = /bit\.ly|tinyurl|t\.co|goo\.gl|is\.gd|shorturl/i;
const RAW_IP_URL_RE = /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
const SUSPICIOUS_TLD_RE = /\.(ru|tk|xyz|top|buzz|click|gq|ml|cf|ga|pw)\b/i;
const PASTE_SERVICE_RE = /pastebin\.com|paste\.ee|hastebin|ghostbin|rentry\.co/i;
const CDN_ABUSE_RE = /discord\.com\/attachments|cdn\.discordapp|t\.me\/|telegram\.me/i;
const CLICKFIX_RE = /paste\s+this\s+(command|into\s+terminal)|copy\s+and\s+run|run\s+this\s+in\s+your\s+terminal/i;
const DMG_DOWNLOAD_RE = /\.dmg\b|hdiutil\s+attach|installer\s+-pkg/i;

// ── Content exposure ──

const ARBITRARY_FETCH_RE = /fetch\s*\(\s*(?:url|input|user|request)/i;

export interface SkillAuditOptions {
  /** Raw SKILL.md content */
  skillContent: string;
  /** Skill name (for typosquatting check) */
  skillName?: string;
  /** Additional files bundled with the skill */
  bundledFiles?: Map<string, string>;
}

export async function scanSkill(opts: SkillAuditOptions): Promise<UnifiedScanResult> {
  const start = Date.now();
  const checks: ScanCheck[] = [];
  let autoFail = false;
  let autoFailReason: string | undefined;

  const content = opts.skillContent;
  const allText = [content, ...(opts.bundledFiles?.values() || [])].join("\n");

  // ── Parse frontmatter ──
  const hasFrontmatter = /^---\n[\s\S]*?\n---/.test(content);
  const nameMatch = content.match(/^name:\s*(.+)/m);
  const descMatch = content.match(/^description:\s*(.+)/m);
  const skillName = opts.skillName || nameMatch?.[1]?.trim() || "unknown";

  // ── PROMPT INJECTION (SKILL-001 to SKILL-005) ──

  let injectionCount = 0;
  for (const { id, pattern, label, severity } of INJECTION_PATTERNS) {
    if (pattern.test(allText)) {
      injectionCount++;
      checks.push({
        id: `SKILL-${id}`,
        category: "prompt_injection",
        label,
        status: "fail",
        score: 0,
        maxScore: 5,
        details: `Detected: ${label}`,
        severity,
      });
      autoFail = true;
      autoFailReason = autoFailReason || `Prompt injection: ${label}`;
    }
  }

  if (injectionCount === 0) {
    checks.push({
      id: "SKILL-INJ-CLEAN",
      category: "prompt_injection",
      label: "No injection patterns",
      status: "pass",
      score: 15,
      maxScore: 15,
      details: "No prompt injection patterns detected in skill content.",
    });
  }

  // Obfuscation
  let obfFound = false;
  for (const { pattern, label } of OBFUSCATION_PATTERNS) {
    if (pattern.test(allText)) {
      obfFound = true;
      checks.push({
        id: "SKILL-OBF",
        category: "prompt_injection",
        label: `Obfuscation: ${label}`,
        status: "fail",
        score: 0,
        maxScore: 10,
        details: `Hidden content detected: ${label}`,
        severity: "critical",
      });
      autoFail = true;
      autoFailReason = autoFailReason || `Obfuscation: ${label}`;
      break;
    }
  }
  if (!obfFound) {
    checks.push({
      id: "SKILL-OBF",
      category: "prompt_injection",
      label: "No obfuscation",
      status: "pass",
      score: 10,
      maxScore: 10,
      details: "No Unicode tricks or encoding obfuscation found.",
    });
  }

  // ── MALICIOUS CODE (SKILL-010 to SKILL-014) ──

  let exfilCount = 0;
  for (const { id, pattern, label, severity } of EXFIL_PATTERNS) {
    if (pattern.test(allText)) {
      exfilCount++;
      checks.push({
        id: `SKILL-${id}`,
        category: "malicious_code",
        label,
        status: "fail",
        score: 0,
        maxScore: 5,
        details: `Detected: ${label}`,
        severity,
      });
      autoFail = true;
      autoFailReason = autoFailReason || `Malicious code: ${label}`;
    }
  }

  if (exfilCount === 0) {
    checks.push({
      id: "SKILL-CODE-CLEAN",
      category: "malicious_code",
      label: "No malicious code patterns",
      status: "pass",
      score: 25,
      maxScore: 25,
      details: "No data exfiltration, reverse shells, or dangerous execution patterns found.",
    });
  }

  // ── AMOS / MALWARE INDICATORS (SKILL-020 to SKILL-022) ──

  let c2Found = false;
  for (const indicator of KNOWN_C2_INDICATORS) {
    if (allText.includes(indicator)) {
      c2Found = true;
      break;
    }
  }

  checks.push({
    id: "SKILL-020",
    category: "amos_indicators",
    label: "Known C2 infrastructure",
    status: c2Found ? "fail" : "pass",
    score: c2Found ? 0 : 10,
    maxScore: 10,
    details: c2Found ? "References to known malicious infrastructure." : "No known C2 indicators.",
  });

  if (c2Found) {
    autoFail = true;
    autoFailReason = autoFailReason || "Known C2 infrastructure detected";
  }

  const hasDmg = DMG_DOWNLOAD_RE.test(allText);
  checks.push({
    id: "SKILL-021",
    category: "amos_indicators",
    label: "macOS installer patterns",
    status: hasDmg ? "fail" : "pass",
    score: hasDmg ? 0 : 5,
    maxScore: 5,
    details: hasDmg ? "DMG download or macOS installer commands detected." : "No macOS installer patterns.",
  });

  // ── SUSPICIOUS DOWNLOADS (SKILL-030 to SKILL-032) ──

  const hasShortener = URL_SHORTENER_RE.test(allText);
  const hasRawIp = RAW_IP_URL_RE.test(allText);
  const hasSuspiciousTld = SUSPICIOUS_TLD_RE.test(allText);
  const hasPaste = PASTE_SERVICE_RE.test(allText);
  const hasCdnAbuse = CDN_ABUSE_RE.test(allText);
  const hasClickfix = CLICKFIX_RE.test(allText);

  const downloadIssues = [
    hasShortener && "URL shortener",
    hasRawIp && "raw IP URL",
    hasSuspiciousTld && "suspicious TLD",
    hasPaste && "paste service",
    hasCdnAbuse && "Discord/Telegram CDN",
    hasClickfix && "ClickFix social engineering",
  ].filter(Boolean);

  checks.push({
    id: "SKILL-030",
    category: "suspicious_downloads",
    label: "Download safety",
    status: downloadIssues.length === 0 ? "pass" : hasClickfix ? "fail" : "warn",
    score: downloadIssues.length === 0 ? 15 : hasClickfix ? 0 : 5,
    maxScore: 15,
    details: downloadIssues.length === 0
      ? "No suspicious download patterns."
      : `Found: ${downloadIssues.join(", ")}`,
  });

  if (hasClickfix) {
    autoFail = true;
    autoFailReason = autoFailReason || "ClickFix social engineering pattern detected";
  }

  // ── CREDENTIALS (SKILL-040 to SKILL-042) ──

  let secretCount = 0;
  for (const { pattern, label } of SECRET_PATTERNS) {
    if (pattern.test(allText)) {
      secretCount++;
      if (secretCount <= 2) {
        checks.push({
          id: `SKILL-SEC-${secretCount}`,
          category: "credentials",
          label: `Hardcoded: ${label}`,
          status: "fail",
          score: 0,
          maxScore: 5,
          details: `Detected ${label} in skill content.`,
        });
      }
    }
  }

  if (secretCount === 0) {
    checks.push({
      id: "SKILL-SEC-CLEAN",
      category: "credentials",
      label: "No hardcoded secrets",
      status: "pass",
      score: 10,
      maxScore: 10,
      details: "No API keys, tokens, or credentials found.",
    });
  }

  // ── CONTENT EXPOSURE (SKILL-050) ──

  const hasArbitraryFetch = ARBITRARY_FETCH_RE.test(allText);
  checks.push({
    id: "SKILL-050",
    category: "content_exposure",
    label: "Arbitrary URL fetch",
    status: hasArbitraryFetch ? "warn" : "pass",
    score: hasArbitraryFetch ? 2 : 5,
    maxScore: 5,
    details: hasArbitraryFetch
      ? "Skill fetches arbitrary user-supplied URLs — indirect prompt injection vector."
      : "No arbitrary URL fetching detected.",
  });

  // ── METADATA VALIDATION (SKILL-060 to SKILL-062) ──

  checks.push({
    id: "SKILL-060",
    category: "metadata",
    label: "Frontmatter present",
    status: hasFrontmatter ? "pass" : "warn",
    score: hasFrontmatter ? 5 : 1,
    maxScore: 5,
    details: hasFrontmatter ? "YAML frontmatter is present." : "Missing frontmatter — skill may not follow standard format.",
  });

  checks.push({
    id: "SKILL-061",
    category: "metadata",
    label: "Description provided",
    status: descMatch ? "pass" : "warn",
    score: descMatch ? 3 : 1,
    maxScore: 3,
    details: descMatch ? "Skill has a description." : "No description in frontmatter.",
  });

  // Typosquatting
  const typosquat = detectTyposquatting(skillName);
  checks.push({
    id: "SKILL-062",
    category: "metadata",
    label: "Typosquatting check",
    status: typosquat ? "warn" : "pass",
    score: typosquat ? 1 : 5,
    maxScore: 5,
    details: typosquat || "Skill name does not resemble known legitimate skills.",
  });

  // ── SCORING ──

  const categories: ScanCategory[] = Object.entries(CATEGORY_CONFIG).map(
    ([key, config]) => {
      const catChecks = checks.filter((c) => c.category === key);
      const score = catChecks.reduce((sum, c) => sum + c.score, 0);
      const maxScore = catChecks.reduce((sum, c) => sum + c.maxScore, 0);
      const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 100;
      return {
        category: key,
        label: config.label,
        weight: config.weight,
        score,
        maxScore,
        grade: calculateGrade(pct),
        checks: catChecks,
      };
    }
  );

  const overallScore = Math.round(
    categories.reduce((sum, cat) => {
      const pct = cat.maxScore > 0 ? cat.score / cat.maxScore : 1;
      return sum + pct * cat.weight * 100;
    }, 0)
  );

  const grade = autoFail ? "F" : calculateGrade(overallScore);

  const recommendations: ScanRecommendation[] = [];
  if (injectionCount > 0) {
    recommendations.push({ text: "Skill contains prompt injection — do not install.", severity: "critical" });
  }
  if (exfilCount > 0) {
    recommendations.push({ text: "Malicious code patterns detected — do not install.", severity: "critical" });
  }
  if (hasClickfix) {
    recommendations.push({ text: "ClickFix social engineering detected — skill tricks users into running malware.", severity: "critical" });
  }
  if (secretCount > 0) {
    recommendations.push({ text: "Hardcoded credentials found — rotate any exposed secrets.", severity: "high" });
  }

  return {
    type: "skill",
    target: skillName,
    targetDisplay: skillName,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    overallScore: autoFail ? Math.min(overallScore, 40) : overallScore,
    grade,
    categories,
    checks,
    recommendations,
    shareToken: crypto.randomUUID(),
    autoFailTriggered: autoFail,
    autoFailReason,
    meta: {
      skillName,
      hasFrontmatter,
      contentLength: content.length,
      bundledFileCount: opts.bundledFiles?.size || 0,
    },
  };
}
