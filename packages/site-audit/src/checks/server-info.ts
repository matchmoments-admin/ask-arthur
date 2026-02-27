// Server header parsing — detect version disclosure / info leakage

import type { CheckResult, ServerInfo } from "../types";

// Known server software patterns
const SERVER_PATTERNS: Array<{ pattern: RegExp; software: string }> = [
  { pattern: /^Apache\/?(\S+)?/i, software: "Apache" },
  { pattern: /^nginx\/?(\S+)?/i, software: "nginx" },
  { pattern: /^Microsoft-IIS\/?(\S+)?/i, software: "Microsoft IIS" },
  { pattern: /^LiteSpeed/i, software: "LiteSpeed" },
  { pattern: /^cloudflare/i, software: "Cloudflare" },
  { pattern: /^AmazonS3/i, software: "Amazon S3" },
  { pattern: /^gws/i, software: "Google Web Server" },
  { pattern: /^openresty\/?(\S+)?/i, software: "OpenResty" },
  { pattern: /^Vercel/i, software: "Vercel" },
  { pattern: /^Netlify/i, software: "Netlify" },
];

/** Parse the Server header and extract software/version info */
export function parseServerHeader(raw: string | null): ServerInfo {
  if (!raw) {
    return { raw: null, software: null, version: null, isDisclosed: false };
  }

  for (const { pattern, software } of SERVER_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      const version = match[1] || null;
      return { raw, software, version, isDisclosed: version !== null };
    }
  }

  // Unknown server software — still counts as disclosure if non-empty
  return { raw, software: raw.split("/")[0] || raw, version: null, isDisclosed: true };
}

/** Check Server header for version disclosure */
export function checkServerInfo(headers: Headers): { check: CheckResult; info: ServerInfo } {
  const raw = headers.get("server");
  const info = parseServerHeader(raw);

  // CDN/platform headers are generic, not a concern
  const safePlatforms = ["Cloudflare", "Amazon S3", "Google Web Server", "Vercel", "Netlify"];
  if (info.software && safePlatforms.includes(info.software)) {
    return {
      check: {
        id: "server-info",
        category: "server",
        label: "Server Header Disclosure",
        status: "pass",
        score: 5,
        maxScore: 5,
        details: `Server header shows "${raw}" (CDN/platform, not a disclosure concern).`,
      },
      info,
    };
  }

  if (!raw) {
    return {
      check: {
        id: "server-info",
        category: "server",
        label: "Server Header Disclosure",
        status: "pass",
        score: 5,
        maxScore: 5,
        details: "No Server header present (good — no server information disclosed).",
      },
      info,
    };
  }

  if (info.version) {
    return {
      check: {
        id: "server-info",
        category: "server",
        label: "Server Header Disclosure",
        status: "fail",
        score: 0,
        maxScore: 5,
        details: `Server header discloses "${raw}" including version number. Attackers can target known vulnerabilities for this version.`,
      },
      info,
    };
  }

  return {
    check: {
      id: "server-info",
      category: "server",
      label: "Server Header Disclosure",
      status: "warn",
      score: 3,
      maxScore: 5,
      details: `Server header shows "${raw}". Consider removing to reduce information disclosure.`,
    },
    info,
  };
}
