import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rawFetchCallCount } from "@/lib/raw-external-fetch-scan";

// Every fetch of a URL we don't control goes through the one Outbound Fetch
// Module, safeFetch (packages/scam-engine/src/safe-fetch.ts): guard on every
// hop, SSRF-safe dispatcher, streamed byte cap, one timeout. Before it, ~18
// call sites hand-assembled those controls — two host blocklists drifted and
// one caller followed redirects with no per-hop check. This walks the server
// code and fails on any raw `fetch(` outside safeFetch and the reasoned
// allowlist below. A new entry must say why its host is fixed.

const REPO = path.join(process.cwd(), "../..");
const ROOTS = [
  "packages/scam-engine/src",
  "packages/site-audit/src",
  "packages/extension-audit/src",
  "apps/web/lib",
  "apps/web/app/api",
];
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next", "dist"]);
const EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/** The Module itself. */
const MODULE = "packages/scam-engine/src/safe-fetch.ts";

/** Fixed-host call sites: the URL's host is a constant (or an operator-set
 *  env var / vendor-issued value), never taken from a user, a scraped page or
 *  a lookalike domain. Reason required. */
const FIXED_HOST: Record<string, string> = {
  // scam-engine — vendor APIs
  "packages/scam-engine/src/abr-lookup.ts": "ABR (abr.business.gov.au) API; ABN is a query param.",
  "packages/scam-engine/src/abuseipdb.ts": "AbuseIPDB API; IP is a query param.",
  "packages/scam-engine/src/ct-lookup.ts": "crt.sh API; domain is a query param.",
  "packages/scam-engine/src/deepfake-detect.ts": "Reality Defender / Resemble APIs (upload, fixed hosts).",
  "packages/scam-engine/src/embeddings.ts": "Voyage API.",
  "packages/scam-engine/src/geolocate.ts": "ip-api.com; IP is a path segment on a fixed host.",
  "packages/scam-engine/src/hibp.ts": "Have I Been Pwned API.",
  "packages/scam-engine/src/hive-ai.ts": "Hive API (image bytes uploaded to a fixed host).",
  "packages/scam-engine/src/ipqualityscore.ts": "IPQualityScore API.",
  "packages/scam-engine/src/news-intel/acsc-fetch.ts": "cyber.gov.au RSS (fixed feed URL).",
  "packages/scam-engine/src/phone-footprint/providers/leakcheck.ts": "LeakCheck API.",
  "packages/scam-engine/src/phone-footprint/providers/vonage.ts": "Vonage APIs.",
  "packages/scam-engine/src/providers/apivoid.ts": "APIVoid API; domain is a query param.",
  "packages/scam-engine/src/providers/jev.ts": "TypeSafe Jev API.",
  "packages/scam-engine/src/push-sender.ts": "Expo push API.",
  "packages/scam-engine/src/rdap-bootstrap.ts": "IANA RDAP bootstrap file (data.iana.org).",
  "packages/scam-engine/src/rdap.ts": "RDAP registry servers named by the IANA bootstrap (isPrivateURL-checked); domain is a path segment.",
  "packages/scam-engine/src/rerank.ts": "Voyage rerank API.",
  "packages/scam-engine/src/urlscan-search.ts": "urlscan.io search API.",
  "packages/scam-engine/src/urlscan.ts": "urlscan.io submit/result API (urlscan fetches the target, not us).",
  "packages/scam-engine/src/whois.ts": "WHOIS API provider.",
  // site-audit / extension-audit
  "packages/site-audit/src/checks/dnssec.ts": "DNS-over-HTTPS resolver (fixed provider); domain is a query param.",
  "packages/extension-audit/src/scanner.ts": "Google CRX endpoint (clients2.google.com); extension id is query-encoded; only Google issues the redirect.",
  // apps/web — platform / vendor APIs
  "apps/web/lib/axiom-query.ts": "Axiom query API.",
  "apps/web/lib/bot-message-processor.ts": "Telegram Bot API.",
  "apps/web/lib/bots/messenger/api.ts": "Meta Graph API (Messenger send).",
  "apps/web/lib/bots/whatsapp/api.ts": "Meta Graph API (WhatsApp send).",
  "apps/web/lib/bots/whatsapp/media.ts": "Meta Graph API; the download URL is returned by Graph for a signature-verified media id.",
  "apps/web/lib/clone-watch/netcraft-issue-report.ts": "Netcraft report API.",
  "apps/web/lib/clone-watch/netcraft-report.ts": "Netcraft report API.",
  "apps/web/lib/clone-watch/netcraft-urls.ts": "Netcraft report API.",
  "apps/web/lib/documentCheckClient.ts": "Browser → our own /api route (relative URL).",
  "apps/web/lib/ghost-admin.ts": "Ghost Admin API at an operator-configured URL.",
  "apps/web/lib/hooks/useMediaAnalysis.ts": "Browser → our own /api routes (relative URLs).",
  "apps/web/lib/linkedin/client.ts": "LinkedIn API.",
  "apps/web/lib/newsletter/delivery.ts": "Resend API.",
  "apps/web/lib/newsletter-subscription.ts": "Resend audiences API.",
  "apps/web/lib/resembleDetect.ts": "Resemble API.",
  "apps/web/lib/social-publish.ts": "Social platform publish APIs.",
  "apps/web/lib/track.ts": "Browser → our own /api/events (relative URL).",
  "apps/web/app/api/admin/feeds/route.ts": "GitHub API workflow dispatch (fixed repo URL).",
  "apps/web/app/api/cron/clone-lead-digest/route.ts": "Slack incoming-webhook URL from env.",
  "apps/web/app/api/extension/_lib/turnstile.ts": "Cloudflare Turnstile siteverify.",
  "apps/web/app/api/extension/extension-security/_lib/crx-parser.ts": "Google CRX endpoint; extension id is query-encoded.",
  "apps/web/app/api/inngest/functions/billing-ingest-nightly.ts": "Billing vendor APIs.",
  "apps/web/app/api/leads/route.ts": "Resend API.",
  "apps/web/app/api/org/invite/route.ts": "Resend API.",
};

function scan(): string[] {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (EXT.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
        const rel = path.relative(REPO, full);
        if (rel === MODULE || FIXED_HOST[rel]) continue;
        const n = rawFetchCallCount(fs.readFileSync(full, "utf8"));
        if (n > 0) offenders.push(`${rel} (${n} raw fetch call${n === 1 ? "" : "s"})`);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(REPO, r));
  return offenders;
}

describe("external fetches go through safeFetch", () => {
  it("has no raw fetch( outside safeFetch and the fixed-host allowlist", () => {
    expect(scan()).toEqual([]);
  });

  it("every allowlisted file still exists and still fetches (no stale entries)", () => {
    for (const rel of Object.keys(FIXED_HOST)) {
      const full = path.join(REPO, rel);
      expect(fs.existsSync(full), `${rel} no longer exists`).toBe(true);
      expect(rawFetchCallCount(fs.readFileSync(full, "utf8")), `${rel} has no fetch( — remove it`).toBeGreaterThan(0);
    }
  });

  it("the Module exists where the exemption says (and the walker is proven by the stale-entry check above)", () => {
    expect(fs.existsSync(path.join(REPO, MODULE))).toBe(true);
  });
});

// Go-red: planted fixtures in a temp dir, never the real tree.
describe("rawFetchCallCount", () => {
  const cases: Array<[string, string, number]> = [
    ["bare call", "const r = await fetch(url);", 1],
    ["multi-line", "const r = await fetch(\n  url,\n  { method: 'GET' },\n);", 1],
    ["globalThis", "await globalThis.fetch(u)", 1],
    ["window", "window . fetch(u)", 1],
    ["two calls", "await fetch(a); await fetch(b);", 2],
    ["method on another object is not a raw fetch", "await client.fetch(u); await sb.fetch(x)", 0],
    ["identifier containing fetch", "await safeFetch(u); prefetch(x); fetchAll(y)", 0],
    ["comment", "// await fetch(u)\n/* fetch(x) */", 0],
    ["string / template literal", "const s = 'fetch(u)'; const t = `fetch(${u})`;", 0],
  ];
  it.each(cases)("%s", (_label, src, want) => {
    expect(rawFetchCallCount(src)).toBe(want);
  });

  it("flags a planted raw fetch in a temp tree", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raw-fetch-"));
    try {
      const f = path.join(dir, "planted.ts");
      fs.writeFileSync(f, "export async function x(u: string) { return fetch(u); }\n");
      expect(rawFetchCallCount(fs.readFileSync(f, "utf8"))).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
