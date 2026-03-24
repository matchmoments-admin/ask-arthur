// Universal input type detection for the security scanner.
// Evaluates input in priority order and returns the detected scan type.

import type { ScanType } from "@askarthur/types/scanner";

export type DetectedInput =
  | { type: "extension"; value: string; extensionId: string }
  | { type: "skill"; value: string; skillId: string }
  | { type: "mcp-server"; value: string; packageName: string }
  | { type: "mcp-config"; value: string; serverCount: number }
  | { type: "website"; value: string; domain: string }
  | { type: "unknown"; value: string };

// Chrome extension ID: 32 lowercase alphanumeric characters
const EXTENSION_ID_RE = /^[a-z]{32}$/;
const CHROME_STORE_RE = /chrome\.google\.com\/webstore\/detail\/[^/]+\/([a-z]{32})/;
const EDGE_STORE_RE = /microsoftedge\.microsoft\.com\/addons\/detail\/[^/]+\/([a-z]{32})/;

// ClawHub skill references
const CLAWHUB_RE = /clawhub\.ai\/skills\/([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?)/;
const SKILL_SCOPE_RE = /^@[a-zA-Z0-9_-]+\/skill-[a-zA-Z0-9_-]+$/;

// npm package patterns
const NPM_SCOPED_RE = /^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/;
const MCP_SERVER_RE = /^mcp-server-[a-zA-Z0-9._-]+$/;
const GITHUB_MCP_RE = /github\.com\/[^/]+\/([^/]*mcp[^/]*)/i;

// MCP config JSON
const MCP_CONFIG_RE = /^\s*\{[\s\S]*"mcpServers"\s*:/;

// URL / domain patterns
const URL_RE = /^https?:\/\//i;
const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

export function detectInput(raw: string): DetectedInput {
  const value = raw.trim();
  if (!value) return { type: "unknown", value };

  // 1. Chrome extension — store URL or 32-char ID
  const chromeMatch = value.match(CHROME_STORE_RE) || value.match(EDGE_STORE_RE);
  if (chromeMatch) {
    return { type: "extension", value, extensionId: chromeMatch[1] };
  }
  if (EXTENSION_ID_RE.test(value)) {
    return { type: "extension", value, extensionId: value };
  }

  // 2. OpenClaw skill — ClawHub URL or @scope/skill-name
  const clawMatch = value.match(CLAWHUB_RE);
  if (clawMatch) {
    return { type: "skill", value, skillId: clawMatch[1] };
  }
  if (SKILL_SCOPE_RE.test(value)) {
    return { type: "skill", value, skillId: value };
  }

  // 3. MCP server — npm scoped package or mcp-server-* pattern
  if (MCP_SERVER_RE.test(value)) {
    return { type: "mcp-server", value, packageName: value };
  }
  if (NPM_SCOPED_RE.test(value) && !SKILL_SCOPE_RE.test(value)) {
    // Scoped npm package — could be MCP or general; classify as MCP if name hints
    const isMcp = /mcp|model-context|server/i.test(value);
    if (isMcp) {
      return { type: "mcp-server", value, packageName: value };
    }
    // Generic scoped package — still route to MCP scanner for npm analysis
    return { type: "mcp-server", value, packageName: value };
  }

  // 4. GitHub repo URL containing "mcp"
  const ghMatch = value.match(GITHUB_MCP_RE);
  if (ghMatch) {
    return { type: "mcp-server", value, packageName: ghMatch[1] };
  }

  // 5. MCP config JSON
  if (MCP_CONFIG_RE.test(value)) {
    try {
      const parsed = JSON.parse(value);
      const servers = parsed.mcpServers || {};
      return { type: "mcp-config", value, serverCount: Object.keys(servers).length };
    } catch {
      // Invalid JSON — fall through
    }
  }

  // 6. URL or domain → website
  if (URL_RE.test(value)) {
    try {
      const domain = new URL(value).hostname;
      return { type: "website", value, domain };
    } catch {
      // Invalid URL — fall through
    }
  }
  if (DOMAIN_RE.test(value)) {
    return { type: "website", value: `https://${value}`, domain: value };
  }

  return { type: "unknown", value };
}

/** Human-readable label for each scan type */
export const SCAN_TYPE_LABELS: Record<ScanType | "mcp-config" | "unknown", { label: string; icon: string }> = {
  website: { label: "Website", icon: "🌐" },
  extension: { label: "Extension", icon: "🧩" },
  "mcp-server": { label: "MCP Server", icon: "🔌" },
  skill: { label: "AI Skill", icon: "⚡" },
  "mcp-config": { label: "MCP Config", icon: "📋" },
  unknown: { label: "Unknown", icon: "❓" },
};

/** Placeholder examples that cycle in the input bar */
export const INPUT_EXAMPLES = [
  { text: "example.com", type: "website" as const },
  { text: "nkbihfbeogaeaoehlefnkodbefgpgknn", type: "extension" as const },
  { text: "@modelcontextprotocol/server-filesystem", type: "mcp-server" as const },
  { text: "clawhub.ai/skills/web-search", type: "skill" as const },
];
