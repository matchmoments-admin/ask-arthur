// MCP server audit scanner — fetches npm package, analyzes for OWASP MCP Top 10 risks.

import type { ScanCheck, ScanCategory, ScanRecommendation, UnifiedScanResult } from "@askarthur/types/scanner";
import { calculateGrade } from "@askarthur/types/scanner";
import {
  INJECTION_PATTERNS,
  OBFUSCATION_PATTERNS,
  POISONING_PATTERNS,
  SECRET_PATTERNS,
  EXFIL_PATTERNS,
  SUSPICIOUS_SCRIPTS,
  KNOWN_C2_INDICATORS,
  detectTyposquatting,
} from "./patterns";
import { matchCve, cvssToSeverity, type McpCveRule } from "./cve-rulepack";

interface NpmPackageMeta {
  name: string;
  description?: string;
  readme?: string;
  "dist-tags"?: { latest?: string };
  versions?: Record<string, {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    dist?: { tarball?: string };
    readme?: string;
  }>;
  maintainers?: Array<{ name: string }>;
  time?: Record<string, string>;
  repository?: { url?: string };
}

interface OsvVuln {
  id: string;
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
}

type McpCheckCategory =
  | "tool_poisoning"
  | "permission_scope"
  | "supply_chain"
  | "credentials"
  | "network"
  | "config";

const CATEGORY_CONFIG: Record<McpCheckCategory, { label: string; weight: number }> = {
  tool_poisoning: { label: "Tool Poisoning", weight: 0.25 },
  permission_scope: { label: "Permission Scope", weight: 0.15 },
  supply_chain: { label: "Supply Chain", weight: 0.20 },
  credentials: { label: "Credential Handling", weight: 0.20 },
  network: { label: "Network Security", weight: 0.10 },
  config: { label: "Configuration", weight: 0.10 },
};

// Fetch npm package metadata
async function fetchPackageMeta(packageName: string): Promise<NpmPackageMeta> {
  const encoded = packageName.startsWith("@")
    ? packageName.replace("/", "%2F")
    : packageName;
  const res = await fetch(`https://registry.npmjs.org/${encoded}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Package not found: ${packageName} (${res.status})`);
  return res.json();
}

// Query OSV.dev for vulnerabilities in dependencies
async function queryOsv(
  deps: Record<string, string>
): Promise<Map<string, OsvVuln[]>> {
  const queries = Object.entries(deps).map(([name, version]) => ({
    package: { name, ecosystem: "npm" },
    version: version.replace(/^[\^~>=<]/, ""),
  }));

  if (queries.length === 0) return new Map();

  // Batch query (max 1000)
  const res = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries: queries.slice(0, 100) }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return new Map();

  const data = await res.json();
  const results = new Map<string, OsvVuln[]>();

  for (let i = 0; i < queries.length && i < (data.results?.length ?? 0); i++) {
    const vulns = data.results[i]?.vulns;
    if (vulns?.length) {
      results.set(queries[i].package.name, vulns);
    }
  }

  return results;
}

export interface McpAuditOptions {
  packageName: string;
}

export async function scanMcpServer(opts: McpAuditOptions): Promise<UnifiedScanResult> {
  const start = Date.now();
  const checks: ScanCheck[] = [];
  let autoFail = false;
  let autoFailReason: string | undefined;

  // Fetch package metadata
  const meta = await fetchPackageMeta(opts.packageName);
  const latest = meta["dist-tags"]?.latest;
  const latestVersion = latest && meta.versions ? meta.versions[latest] : null;
  const allDeps = { ...(latestVersion?.dependencies || {}) };
  const scripts = latestVersion?.scripts || {};
  const description = meta.description || "";

  // ── TOOL POISONING CHECKS (MCP03) ──

  let injectionCount = 0;
  for (const { id, pattern, label, severity } of INJECTION_PATTERNS) {
    if (pattern.test(description)) {
      injectionCount++;
      checks.push({
        id: `MCP-TP-${id}`,
        category: "tool_poisoning",
        label,
        status: "fail",
        score: 0,
        maxScore: 5,
        details: `Package description contains injection pattern: "${label}"`,
        reference: "MCP03",
        severity,
      });
    }
  }

  if (injectionCount === 0) {
    checks.push({
      id: "MCP-TP-CLEAN",
      category: "tool_poisoning",
      label: "No injection patterns in description",
      status: "pass",
      score: 20,
      maxScore: 20,
      details: "Package description is clean of prompt injection patterns.",
      reference: "MCP03",
    });
  }

  // README poisoning scan — MCP tool descriptions are embedded in README text,
  // not in the npm registry metadata. Scan up to 32 KB of README for tool-poisoning
  // and prompt-injection patterns targeted at agent readers (Invariant Labs, Apr 2025).
  const readmeRaw = meta.readme ?? latestVersion?.readme ?? "";
  const readme = readmeRaw.length > 32_768 ? readmeRaw.slice(0, 32_768) : readmeRaw;
  const readmeFindings: Array<{ id: string; label: string; severity: "critical" | "high" | "medium" }> = [];

  if (readme) {
    for (const { id, pattern, label, severity } of POISONING_PATTERNS) {
      if (pattern.test(readme)) readmeFindings.push({ id, label, severity });
    }
    // Also run INJECTION_PATTERNS on README — same patterns, different context.
    for (const { id, pattern, label, severity } of INJECTION_PATTERNS) {
      if (pattern.test(readme)) readmeFindings.push({ id, label: `README: ${label}`, severity });
    }
  }

  if (readmeFindings.length === 0) {
    checks.push({
      id: "MCP-TP-README-CLEAN",
      category: "tool_poisoning",
      label: readme ? "No poisoning patterns in README" : "README not available",
      status: readme ? "pass" : "warn",
      score: readme ? 10 : 5,
      maxScore: 10,
      details: readme
        ? `Scanned ${readme.length} bytes of README — no tool-poisoning patterns detected.`
        : "npm registry did not return README content for this package.",
      reference: "MCP03",
    });
  } else {
    // Emit up to 5 distinct findings to avoid a wall of check rows.
    const seen = new Set<string>();
    for (const finding of readmeFindings) {
      if (seen.has(finding.id) || seen.size >= 5) continue;
      seen.add(finding.id);
      checks.push({
        id: `MCP-TP-README-${finding.id}`,
        category: "tool_poisoning",
        label: `README poisoning: ${finding.label}`,
        status: finding.severity === "medium" ? "warn" : "fail",
        score: 0,
        maxScore: 5,
        details: `README contains ${finding.label.toLowerCase()} — consistent with MCP tool-description poisoning.`,
        reference: "MCP03",
        severity: finding.severity,
      });
    }
    if (readmeFindings.some((f) => f.severity === "critical")) {
      autoFail = true;
      autoFailReason = autoFailReason ?? "Critical tool-poisoning pattern in README";
    }
  }

  // Obfuscation check
  let obfuscationFound = false;
  for (const { pattern, label } of OBFUSCATION_PATTERNS) {
    if (pattern.test(description)) {
      obfuscationFound = true;
      checks.push({
        id: "MCP-TP-OBF",
        category: "tool_poisoning",
        label: `Obfuscation: ${label}`,
        status: "fail",
        score: 0,
        maxScore: 10,
        details: `Obfuscation technique detected in package description.`,
        reference: "MCP03",
      });
      autoFail = true;
      autoFailReason = `Obfuscation detected: ${label}`;
      break;
    }
  }
  if (!obfuscationFound) {
    checks.push({
      id: "MCP-TP-OBF",
      category: "tool_poisoning",
      label: "No obfuscation detected",
      status: "pass",
      score: 10,
      maxScore: 10,
      details: "No hidden Unicode characters or encoding tricks found.",
      reference: "MCP03",
    });
  }

  // ── SUPPLY CHAIN CHECKS (MCP04) ──

  // Typosquatting
  const typosquat = detectTyposquatting(opts.packageName);
  checks.push({
    id: "MCP-SC-002",
    category: "supply_chain",
    label: "Typosquatting detection",
    status: typosquat ? "warn" : "pass",
    score: typosquat ? 3 : 10,
    maxScore: 10,
    details: typosquat || "Package name does not resemble known legitimate packages.",
    reference: "MCP04",
  });

  // Suspicious lifecycle scripts
  const suspiciousScriptNames = ["preinstall", "postinstall", "preuninstall"];
  const dangerousScripts: string[] = [];

  for (const scriptName of suspiciousScriptNames) {
    const scriptContent = scripts[scriptName];
    if (!scriptContent) continue;

    for (const { pattern, label } of SUSPICIOUS_SCRIPTS) {
      if (pattern.test(scriptContent)) {
        dangerousScripts.push(`${scriptName}: ${label}`);
      }
    }
  }

  checks.push({
    id: "MCP-SC-003",
    category: "supply_chain",
    label: "Lifecycle script safety",
    status: dangerousScripts.length === 0 ? "pass" : "fail",
    score: dangerousScripts.length === 0 ? 15 : 0,
    maxScore: 15,
    details: dangerousScripts.length === 0
      ? "No suspicious lifecycle scripts detected."
      : `Dangerous patterns in scripts: ${dangerousScripts.join("; ")}`,
    reference: "MCP04",
  });

  if (dangerousScripts.some((s) => s.includes("Network request") || s.includes("Code execution"))) {
    autoFail = true;
    autoFailReason = "Suspicious lifecycle scripts executing code or fetching remote content";
  }

  // Dependency vulnerabilities (OSV.dev)
  let vulnMap = new Map<string, OsvVuln[]>();
  let osvFailed = false;
  try {
    vulnMap = await queryOsv(allDeps);
  } catch {
    osvFailed = true;
  }

  const totalVulns = Array.from(vulnMap.values()).reduce((sum, v) => sum + v.length, 0);
  const criticalVulns = Array.from(vulnMap.values())
    .flat()
    .filter((v) => v.severity?.some((s) => parseFloat(s.score) >= 9.0));

  checks.push({
    id: "MCP-SC-001",
    category: "supply_chain",
    label: "Dependency vulnerabilities",
    status: osvFailed ? "error" : totalVulns === 0 ? "pass" : criticalVulns.length > 0 ? "fail" : "warn",
    score: osvFailed ? 0 : totalVulns === 0 ? 15 : criticalVulns.length > 0 ? 0 : 5,
    maxScore: 15,
    details: osvFailed
      ? `Vulnerability database (OSV.dev) unavailable — ${Object.keys(allDeps).length} dependencies could not be checked.`
      : totalVulns === 0
        ? `${Object.keys(allDeps).length} dependencies checked — no known vulnerabilities.`
        : `${totalVulns} vulnerability/ies in ${vulnMap.size} package(s)${criticalVulns.length > 0 ? ` (${criticalVulns.length} critical)` : ""}.`,
    reference: "MCP04",
  });

  // MCP-specific CVE rulepack — catches MCP server CVEs that aren't always in OSV.
  const rulepackMatches: Array<{ pkg: string; version: string; rule: McpCveRule }> = [];
  if (latest) {
    for (const rule of matchCve(opts.packageName, latest)) {
      rulepackMatches.push({ pkg: opts.packageName, version: latest, rule });
    }
  }
  for (const [depName, depRange] of Object.entries(allDeps)) {
    for (const rule of matchCve(depName, depRange)) {
      rulepackMatches.push({ pkg: depName, version: depRange, rule });
    }
  }

  if (rulepackMatches.length === 0) {
    checks.push({
      id: "MCP-SC-005",
      category: "supply_chain",
      label: "MCP CVE rulepack",
      status: "pass",
      score: 10,
      maxScore: 10,
      details: `No known MCP-specific CVEs matched the target or its ${Object.keys(allDeps).length} dependencies.`,
      reference: "MCP04",
    });
  } else {
    const criticalRulepack = rulepackMatches.filter((m) => m.rule.cvss >= 9.0);
    for (const [i, match] of rulepackMatches.entries()) {
      const severity = cvssToSeverity(match.rule.cvss);
      checks.push({
        id: `MCP-SC-005-${i + 1}`,
        category: "supply_chain",
        label: `${match.rule.cve} — ${match.rule.summary}`,
        status: match.rule.cvss >= 9.0 ? "fail" : match.rule.cvss >= 7.0 ? "fail" : "warn",
        score: 0,
        maxScore: 10,
        details: `${match.pkg}@${match.version} matches ${match.rule.vulnerableRange} (CVSS ${match.rule.cvss}). ${match.rule.reference}`,
        reference: "MCP04",
        severity,
      });
    }
    if (criticalRulepack.length > 0) {
      autoFail = true;
      autoFailReason = `Critical MCP CVE match: ${criticalRulepack.map((m) => m.rule.cve).join(", ")}`;
    }
  }

  // Package provenance — check real signals (integrity, signatures, repo link)
  const isOfficial = opts.packageName.startsWith("@modelcontextprotocol/");
  const maintainerCount = meta.maintainers?.length ?? 0;
  const hasRepo = !!meta.repository?.url;
  const hasIntegrity = !!latestVersion?.dist?.tarball;
  const provenanceSignals = [isOfficial, hasRepo, maintainerCount > 1, hasIntegrity].filter(Boolean).length;
  checks.push({
    id: "MCP-SC-004",
    category: "supply_chain",
    label: "Package provenance",
    status: isOfficial ? "pass" : provenanceSignals >= 3 ? "pass" : provenanceSignals >= 2 ? "pass" : "warn",
    score: isOfficial ? 10 : Math.min(10, provenanceSignals * 3),
    maxScore: 10,
    details: isOfficial
      ? "Official @modelcontextprotocol scope — trusted publisher."
      : `${maintainerCount} maintainer(s). ${hasRepo ? "Has linked repository." : "No linked repository."} ${hasIntegrity ? "Signed tarball." : ""}`.trim(),
    reference: "MCP04",
  });

  // ── CREDENTIAL HANDLING CHECKS (MCP01) ──

  let secretsFound = 0;
  for (const { pattern, label } of SECRET_PATTERNS) {
    if (pattern.test(JSON.stringify(latestVersion || {}))) {
      secretsFound++;
      if (secretsFound <= 3) {
        checks.push({
          id: `MCP-CH-${secretsFound}`,
          category: "credentials",
          label: `Hardcoded secret: ${label}`,
          status: "fail",
          score: 0,
          maxScore: 10,
          details: `Detected ${label} in package metadata.`,
          reference: "MCP01",
        });
      }
    }
  }

  if (secretsFound === 0) {
    checks.push({
      id: "MCP-CH-CLEAN",
      category: "credentials",
      label: "No hardcoded secrets",
      status: "pass",
      score: 20,
      maxScore: 20,
      details: "No API keys, tokens, or credentials detected in package metadata.",
      reference: "MCP01",
    });
  }

  if (secretsFound > 0) {
    autoFail = true;
    autoFailReason = `${secretsFound} hardcoded secret(s) detected`;
  }

  // ── PERMISSION SCOPE CHECKS (MCP02, MCP07) ──

  const depNames = Object.keys(allDeps);
  const hasFs = depNames.some((d) => /^(fs-extra|graceful-fs|glob|rimraf)$/.test(d));
  const hasNet = depNames.some((d) => /^(axios|node-fetch|got|undici|request)$/.test(d));
  const hasExec = depNames.some((d) => /^(execa|shelljs|cross-spawn)$/.test(d));

  checks.push({
    id: "MCP-PS-001",
    category: "permission_scope",
    label: "Capability analysis",
    status: hasFs && hasNet ? "warn" : "pass",
    score: hasFs && hasNet ? 5 : hasExec ? 8 : 15,
    maxScore: 15,
    details: hasFs && hasNet
      ? "Package has both filesystem and network dependencies — potential exfiltration path."
      : hasExec
        ? "Package has shell execution dependency."
        : "No concerning capability combinations detected.",
    reference: "MCP02",
  });

  // ── NETWORK SECURITY CHECKS ──

  let c2Found = false;
  const stringified = JSON.stringify(meta);
  for (const indicator of KNOWN_C2_INDICATORS) {
    if (stringified.includes(indicator)) {
      c2Found = true;
      break;
    }
  }

  checks.push({
    id: "MCP-NE-001",
    category: "network",
    label: "Known malicious infrastructure",
    status: c2Found ? "fail" : "pass",
    score: c2Found ? 0 : 10,
    maxScore: 10,
    details: c2Found
      ? "References to known malicious C2 infrastructure detected."
      : "No known malicious infrastructure references.",
  });

  if (c2Found) {
    autoFail = true;
    autoFailReason = "Known malicious infrastructure detected";
  }

  // ── CONFIG SECURITY CHECKS ──

  const publishDate = meta.time?.[latest || ""] || null;
  const daysSincePublish = publishDate
    ? Math.floor((Date.now() - new Date(publishDate).getTime()) / 86400000)
    : null;

  checks.push({
    id: "MCP-CF-001",
    category: "config",
    label: "Package freshness",
    status: daysSincePublish === null ? "warn"
      : daysSincePublish > 365 ? "warn"
      : daysSincePublish < 7 ? "warn"
      : "pass",
    score: daysSincePublish === null ? 5
      : daysSincePublish > 365 ? 5
      : daysSincePublish < 7 ? 5
      : 10,
    maxScore: 10,
    details: daysSincePublish === null
      ? "Could not determine publish date."
      : daysSincePublish > 365
        ? `Last published ${daysSincePublish} days ago — may be unmaintained.`
        : daysSincePublish < 7
          ? `Published ${daysSincePublish} days ago — very new package.`
          : `Published ${daysSincePublish} days ago.`,
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
  if (injectionCount > 0) {
    recommendations.push({ text: "Package description contains prompt injection patterns — do not use.", severity: "critical" });
  }
  if (secretsFound > 0) {
    recommendations.push({ text: "Hardcoded secrets detected — rotate any exposed credentials immediately.", severity: "critical" });
  }
  if (dangerousScripts.length > 0) {
    recommendations.push({ text: "Review lifecycle scripts before installing — they execute arbitrary code.", severity: "high" });
  }
  if (totalVulns > 0) {
    recommendations.push({ text: `${totalVulns} known vulnerabilities in dependencies — check for updates.`, severity: "high" });
  }
  if (typosquat) {
    recommendations.push({ text: `Package name resembles a legitimate package — verify you have the correct one.`, severity: "medium" });
  }

  return {
    type: "mcp-server",
    target: opts.packageName,
    targetDisplay: meta.name || opts.packageName,
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
      packageName: meta.name,
      latestVersion: latest,
      description: description.slice(0, 200),
      maintainerCount,
      dependencyCount: Object.keys(allDeps).length,
      vulnerabilityCount: totalVulns,
      rulepackMatches: rulepackMatches.map((m) => ({
        cve: m.rule.cve,
        package: m.pkg,
        version: m.version,
        cvss: m.rule.cvss,
        vulnerableRange: m.rule.vulnerableRange,
      })),
    },
  };
}
