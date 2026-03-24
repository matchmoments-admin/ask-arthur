// Extension audit scanner — downloads CRX, analyzes manifest + source code,
// returns unified scan result with A+ to F grade.

import JSZip from "jszip";
import type { ScanCheck, ScanCategory, ScanRecommendation, UnifiedScanResult } from "@askarthur/types/scanner";
import { calculateGrade } from "@askarthur/types/scanner";
import type { CRXManifest, ExtCheckCategory, ExtensionAuditOptions } from "./types";

// ── CRX Download + Parse ──

const CRX_MAGIC = 0x34327243;
const MAX_CRX_SIZE = 50 * 1024 * 1024;

async function fetchCRX(extensionId: string): Promise<ArrayBuffer> {
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx3&x=id%3D${encodeURIComponent(extensionId)}%26uc`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Failed to fetch CRX: ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_CRX_SIZE) throw new Error("CRX too large");
  return buf;
}

function extractZip(buffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== CRX_MAGIC) throw new Error("Invalid CRX");
  if (view.getUint32(4, true) !== 3) throw new Error("Unsupported CRX version");
  const headerLen = view.getUint32(8, true);
  return buffer.slice(12 + headerLen);
}

async function parseManifest(zipData: ArrayBuffer): Promise<CRXManifest> {
  const zip = await JSZip.loadAsync(zipData);
  const file = zip.file("manifest.json");
  if (!file) throw new Error("No manifest.json in CRX");
  return JSON.parse(await file.async("text"));
}

async function extractSourceFiles(zipData: ArrayBuffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(zipData);
  const sources = new Map<string, string>();
  const jsFiles = zip.filter((path) => path.endsWith(".js") || path.endsWith(".ts"));
  for (const f of jsFiles.slice(0, 50)) { // Limit to 50 files
    try {
      const content = await f.async("text");
      if (content.length < 500_000) { // Skip very large files
        sources.set(f.name, content);
      }
    } catch { /* skip binary/corrupt files */ }
  }
  return sources;
}

// ── Permission Scoring ──

const CRITICAL_PERMS = new Set([
  "cookies", "webRequest", "webRequestBlocking", "debugger",
  "<all_urls>", "management", "nativeMessaging", "clipboardRead",
  "desktopCapture", "privacy", "proxy",
]);

const HIGH_RISK_PERMS = new Set([
  "tabs", "history", "bookmarks", "downloads", "scripting",
  "pageCapture", "tabCapture",
]);

const MEDIUM_PERMS = new Set([
  "storage", "notifications", "alarms", "contextMenus", "unlimitedStorage",
]);

// ── AI Platform Domains ──

const AI_DOMAINS = [
  "claude.ai", "chat.openai.com", "chatgpt.com", "gemini.google.com",
  "copilot.microsoft.com", "perplexity.ai", "deepseek.com", "grok.x.ai", "meta.ai",
];

// ── Dangerous Code Patterns ──

const FETCH_OVERRIDE_RE = /(?:window\.fetch\s*=|const\s+\w+\s*=\s*window\.fetch|Object\.defineProperty\s*\(\s*window\s*,\s*['"]fetch['"]\s*)/;
const XHR_OVERRIDE_RE = /XMLHttpRequest\.prototype\.(open|send)\s*=/;
const EVAL_RE = /\beval\s*\(/;
const REMOTE_SCRIPT_RE = /chrome\.tabs\.executeScript|chrome\.scripting\.executeScript.*url\s*:|new\s+Function\s*\(/;
const EXFIL_INTERVAL_RE = /setInterval\s*\([^)]*(?:fetch|XMLHttpRequest|sendBeacon|navigator\.sendBeacon)/;

// ── Category Weights ──

const CATEGORY_CONFIG: Record<ExtCheckCategory, { label: string; weight: number }> = {
  permissions: { label: "Permissions", weight: 0.20 },
  ai_targeting: { label: "AI Platform Targeting", weight: 0.15 },
  request_interception: { label: "Request Interception", weight: 0.20 },
  csp: { label: "Content Security Policy", weight: 0.10 },
  code_integrity: { label: "Code Integrity", weight: 0.15 },
  publisher: { label: "Publisher & Metadata", weight: 0.05 },
  data_handling: { label: "Data Handling", weight: 0.05 },
  manifest: { label: "Manifest Security", weight: 0.10 },
};

// ── Main Scanner ──

export async function scanExtension(opts: ExtensionAuditOptions): Promise<UnifiedScanResult> {
  const start = Date.now();
  const checks: ScanCheck[] = [];
  let autoFail = false;
  let autoFailReason: string | undefined;

  // Download and parse CRX
  const crxBuffer = await fetchCRX(opts.extensionId);
  const zipData = extractZip(crxBuffer);
  const manifest = await parseManifest(zipData);

  // Optionally extract source files for deeper analysis
  let sources: Map<string, string> | null = null;
  if (!opts.manifestOnly) {
    sources = await extractSourceFiles(zipData);
  }

  const allPerms = [
    ...(manifest.permissions || []),
    ...(manifest.host_permissions || []),
  ];

  // ── PERMISSIONS CHECKS ──

  const criticalCount = allPerms.filter((p) => CRITICAL_PERMS.has(p)).length;
  const highCount = allPerms.filter((p) => HIGH_RISK_PERMS.has(p)).length;

  checks.push({
    id: "EXT-001",
    category: "permissions",
    label: "Critical permissions",
    status: criticalCount === 0 ? "pass" : criticalCount >= 3 ? "fail" : "warn",
    score: criticalCount === 0 ? 20 : criticalCount >= 3 ? 0 : 8,
    maxScore: 20,
    details: criticalCount === 0
      ? "No critical permissions requested."
      : `${criticalCount} critical permission(s): ${allPerms.filter((p) => CRITICAL_PERMS.has(p)).join(", ")}`,
    reference: "EXT-001",
  });

  if (criticalCount >= 3) {
    autoFail = true;
    autoFailReason = `${criticalCount} critical permissions detected`;
  }

  checks.push({
    id: "EXT-002",
    category: "permissions",
    label: "High-risk permissions",
    status: highCount === 0 ? "pass" : "warn",
    score: highCount === 0 ? 10 : Math.max(0, 10 - highCount * 3),
    maxScore: 10,
    details: highCount === 0
      ? "No high-risk permissions."
      : `${highCount} high-risk permission(s): ${allPerms.filter((p) => HIGH_RISK_PERMS.has(p)).join(", ")}`,
    reference: "EXT-002",
  });

  const hasAllUrls = allPerms.includes("<all_urls>") || allPerms.includes("*://*/*");
  checks.push({
    id: "EXT-005",
    category: "permissions",
    label: "Host permission scope",
    status: hasAllUrls ? "fail" : "pass",
    score: hasAllUrls ? 0 : 10,
    maxScore: 10,
    details: hasAllUrls
      ? "Extension can access ALL websites — maximum exposure."
      : "Host permissions are scoped to specific domains.",
    reference: "EXT-005",
  });

  const hasActiveTabOnly = allPerms.includes("activeTab") && !hasAllUrls && criticalCount === 0;
  checks.push({
    id: "EXT-004",
    category: "permissions",
    label: "Active tab pattern",
    status: hasActiveTabOnly ? "pass" : "skipped",
    score: hasActiveTabOnly ? 10 : 0,
    maxScore: 10,
    details: hasActiveTabOnly
      ? "Uses activeTab — best practice for minimal permissions."
      : "Does not use the activeTab-only pattern.",
    reference: "EXT-004",
  });

  // ── AI TARGETING CHECKS ──

  const contentScriptDomains = (manifest.content_scripts || [])
    .flatMap((cs) => cs.matches)
    .filter((m) => AI_DOMAINS.some((d) => m.includes(d)));

  const hostPermAIDomains = allPerms.filter((p) =>
    AI_DOMAINS.some((d) => p.includes(d))
  );

  const aiTargetCount = new Set([...contentScriptDomains, ...hostPermAIDomains]).size;

  checks.push({
    id: "EXT-010",
    category: "ai_targeting",
    label: "AI platform content scripts",
    status: contentScriptDomains.length === 0 ? "pass" : contentScriptDomains.length >= 3 ? "fail" : "warn",
    score: contentScriptDomains.length === 0 ? 15 : contentScriptDomains.length >= 5 ? 0 : 5,
    maxScore: 15,
    details: contentScriptDomains.length === 0
      ? "No content scripts targeting AI platforms."
      : `Content scripts target ${contentScriptDomains.length} AI platform(s).`,
    reference: "EXT-010",
  });

  checks.push({
    id: "EXT-011",
    category: "ai_targeting",
    label: "AI domains in host permissions",
    status: hostPermAIDomains.length === 0 ? "pass" : "warn",
    score: hostPermAIDomains.length === 0 ? 10 : Math.max(0, 10 - hostPermAIDomains.length * 3),
    maxScore: 10,
    details: hostPermAIDomains.length === 0
      ? "No AI domains in host permissions."
      : `${hostPermAIDomains.length} AI domain(s) in host_permissions — enables direct API interception.`,
    reference: "EXT-011",
  });

  // ── REQUEST INTERCEPTION CHECKS (source code analysis) ──

  let fetchOverrideFound = false;
  let xhrOverrideFound = false;
  let exfilIntervalFound = false;

  if (sources) {
    for (const [, content] of sources) {
      if (FETCH_OVERRIDE_RE.test(content)) fetchOverrideFound = true;
      if (XHR_OVERRIDE_RE.test(content)) xhrOverrideFound = true;
      if (EXFIL_INTERVAL_RE.test(content)) exfilIntervalFound = true;
    }
  }

  checks.push({
    id: "EXT-020",
    category: "request_interception",
    label: "fetch() override detection",
    status: !sources ? "skipped" : fetchOverrideFound ? "fail" : "pass",
    score: !sources ? 0 : fetchOverrideFound ? 0 : 15,
    maxScore: 15,
    details: !sources
      ? "Source code analysis skipped."
      : fetchOverrideFound
        ? "Extension overrides window.fetch — can intercept all network requests."
        : "No fetch() override detected.",
    reference: "EXT-020",
  });

  checks.push({
    id: "EXT-021",
    category: "request_interception",
    label: "XMLHttpRequest patching",
    status: !sources ? "skipped" : xhrOverrideFound ? "fail" : "pass",
    score: !sources ? 0 : xhrOverrideFound ? 0 : 15,
    maxScore: 15,
    details: !sources
      ? "Source code analysis skipped."
      : xhrOverrideFound
        ? "Extension patches XMLHttpRequest.prototype — can intercept XHR requests."
        : "No XHR patching detected.",
    reference: "EXT-021",
  });

  if (fetchOverrideFound || xhrOverrideFound) {
    if (aiTargetCount > 0) {
      autoFail = true;
      autoFailReason = "Request interception + AI platform targeting detected (prompt poaching pattern)";
    }
  }

  checks.push({
    id: "EXT-024",
    category: "request_interception",
    label: "Periodic exfiltration pattern",
    status: !sources ? "skipped" : exfilIntervalFound ? "fail" : "pass",
    score: !sources ? 0 : exfilIntervalFound ? 0 : 10,
    maxScore: 10,
    details: !sources
      ? "Source code analysis skipped."
      : exfilIntervalFound
        ? "Detected setInterval with network calls — periodic data exfiltration pattern."
        : "No periodic exfiltration patterns found.",
    reference: "EXT-024",
  });

  // ── CSP CHECKS ──

  const cspStr = typeof manifest.content_security_policy === "string"
    ? manifest.content_security_policy
    : manifest.content_security_policy?.extension_pages ?? "";

  checks.push({
    id: "EXT-030",
    category: "csp",
    label: "CSP defined",
    status: cspStr ? "pass" : "fail",
    score: cspStr ? 10 : 0,
    maxScore: 10,
    details: cspStr ? "Content Security Policy is defined." : "No CSP defined — weakens security protections.",
    reference: "EXT-030",
  });

  checks.push({
    id: "EXT-031a",
    category: "csp",
    label: "No unsafe-eval in CSP",
    status: cspStr.includes("unsafe-eval") ? "fail" : "pass",
    score: cspStr.includes("unsafe-eval") ? 0 : 10,
    maxScore: 10,
    details: cspStr.includes("unsafe-eval")
      ? "CSP contains unsafe-eval — allows arbitrary code execution."
      : "No unsafe-eval in CSP.",
    reference: "EXT-031",
  });

  checks.push({
    id: "EXT-034",
    category: "csp",
    label: "Manifest version",
    status: manifest.manifest_version >= 3 ? "pass" : "fail",
    score: manifest.manifest_version >= 3 ? 10 : 0,
    maxScore: 10,
    details: manifest.manifest_version >= 3
      ? "MV3 — modern extension platform with stronger security defaults."
      : "MV2 — deprecated manifest version with weaker security model.",
    reference: "EXT-034",
  });

  // ── CODE INTEGRITY CHECKS ──

  let evalFound = false;
  let remoteScriptFound = false;

  if (sources) {
    for (const [, content] of sources) {
      if (EVAL_RE.test(content)) evalFound = true;
      if (REMOTE_SCRIPT_RE.test(content)) remoteScriptFound = true;
    }
  }

  checks.push({
    id: "EXT-040",
    category: "code_integrity",
    label: "No eval() usage",
    status: !sources ? "skipped" : evalFound ? "fail" : "pass",
    score: !sources ? 0 : evalFound ? 0 : 15,
    maxScore: 15,
    details: !sources ? "Source analysis skipped." : evalFound
      ? "eval() found in extension code — can execute arbitrary code."
      : "No eval() usage detected.",
    reference: "EXT-040",
  });

  checks.push({
    id: "EXT-041",
    category: "code_integrity",
    label: "No remote code loading",
    status: !sources ? "skipped" : remoteScriptFound ? "fail" : "pass",
    score: !sources ? 0 : remoteScriptFound ? 0 : 15,
    maxScore: 15,
    details: !sources ? "Source analysis skipped." : remoteScriptFound
      ? "Remote script loading detected — code can be changed without update."
      : "No remote code loading detected.",
    reference: "EXT-041",
  });

  if (remoteScriptFound) {
    autoFail = true;
    autoFailReason = "Remote code loading detected — prohibited in MV3";
  }

  // ── MANIFEST CHECKS ──

  const hasBroadContentScripts = (manifest.content_scripts || []).some(
    (cs) => cs.matches.some((m) => m === "<all_urls>" || m === "*://*/*")
  );

  checks.push({
    id: "EXT-060",
    category: "manifest",
    label: "Content script scope",
    status: !manifest.content_scripts?.length ? "pass" : hasBroadContentScripts ? "warn" : "pass",
    score: !manifest.content_scripts?.length ? 10 : hasBroadContentScripts ? 3 : 10,
    maxScore: 10,
    details: !manifest.content_scripts?.length
      ? "No content scripts."
      : hasBroadContentScripts
        ? "Content scripts run on all pages — broad injection scope."
        : "Content scripts target specific domains.",
    reference: "EXT-060",
  });

  checks.push({
    id: "EXT-061",
    category: "manifest",
    label: "Externally connectable",
    status: !manifest.externally_connectable ? "pass"
      : manifest.externally_connectable.matches?.some((m) => m.includes("*")) ? "warn" : "pass",
    score: !manifest.externally_connectable ? 10
      : manifest.externally_connectable.matches?.some((m) => m.includes("*")) ? 3 : 10,
    maxScore: 10,
    details: !manifest.externally_connectable
      ? "Not externally connectable."
      : "Extension accepts external messages — verify handler validation.",
    reference: "EXT-061",
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

  // ── RECOMMENDATIONS ──

  const recommendations: ScanRecommendation[] = [];

  if (criticalCount > 0) {
    recommendations.push({
      text: `Review ${criticalCount} critical permission(s) — consider if each is strictly necessary.`,
      severity: "critical",
    });
  }
  if (hasAllUrls) {
    recommendations.push({
      text: "Replace <all_urls> with specific host permissions to reduce attack surface.",
      severity: "high",
    });
  }
  if (fetchOverrideFound || xhrOverrideFound) {
    recommendations.push({
      text: "Extension overrides network request functions — verify this is necessary and not intercepting sensitive data.",
      severity: "critical",
    });
  }
  if (manifest.manifest_version < 3) {
    recommendations.push({
      text: "Migrate to Manifest V3 for stronger security defaults and continued Chrome Web Store support.",
      severity: "high",
    });
  }
  if (!cspStr) {
    recommendations.push({
      text: "Add a Content Security Policy to restrict script sources and prevent XSS.",
      severity: "high",
    });
  }

  return {
    type: "extension",
    target: opts.extensionId,
    targetDisplay: manifest.name || opts.extensionId,
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
      extensionName: manifest.name,
      manifestVersion: manifest.manifest_version,
      version: manifest.version,
      permissionCount: allPerms.length,
      description: manifest.description?.slice(0, 200),
    },
  };
}
