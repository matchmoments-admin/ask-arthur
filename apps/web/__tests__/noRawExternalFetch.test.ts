import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rawFetchSites, type RawFetchSite } from "@/lib/raw-external-fetch-scan";

// Every fetch of a URL we don't control goes through the one Outbound Fetch
// Module, safeFetch (packages/scam-engine/src/safe-fetch.ts): guard on every
// hop, SSRF-safe dispatcher, streamed byte cap, one timeout. This walks the
// server AND page code and fails on any raw outbound-HTTP call site outside
// safeFetch, same-origin "/…" calls, and the per-call-site allowlist below.
//
// The allowlist is keyed by CALL SITE (file + the trimmed source line of the
// call), not by file: a second fetch added to an allowlisted file is a new
// site and fails until it is reviewed and listed. A new entry must say why
// its host is fixed.

const REPO = path.join(process.cwd(), "../..");
const ROOTS = [
  "packages/scam-engine/src",
  "packages/site-audit/src",
  "packages/extension-audit/src",
  "packages/mcp-audit/src",
  "packages/utils/src",
  "packages/bot-core/src",
  "supabase/functions",
  "apps/web/lib",
  "apps/web/app",
];
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next", "dist"]);
const EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/** The Module itself. */
const MODULE = "packages/scam-engine/src/safe-fetch.ts";

type Allowlist = Record<string, { reason: string; calls: string[] }>;

/** Fixed-host call sites: the URL's host is a constant (or an operator-set
 *  env var / vendor-issued value), never taken from a user, a scraped page or
 *  a lookalike domain. `calls` lists each site's trimmed source line (repeat
 *  a line once per identical call). */
const FIXED_HOST: Allowlist = {
  "packages/scam-engine/src/abr-lookup.ts": {
    reason: "ABR (abr.business.gov.au) API; ABN is a query param.",
    calls: [
      "const response = await fetch(`${ABR_ENDPOINT}?${params.toString()}`, {",
    ],
  },
  "packages/scam-engine/src/abuseipdb.ts": {
    reason: "AbuseIPDB API; IP is a query param.",
    calls: [
      "const res = await fetch(",
    ],
  },
  "packages/scam-engine/src/ct-lookup.ts": {
    reason: "crt.sh API; domain is a query param.",
    calls: [
      "const res = await fetch(",
    ],
  },
  "packages/scam-engine/src/deepfake-detect.ts": {
    reason: "Reality Defender / Resemble APIs (upload, fixed hosts).",
    calls: [
      "const res = await fetch(\"https://api.realitydefender.com/v1/audio/detect\", {",
      "const res = await fetch(\"https://api.resemble.ai/v1/detect\", {",
    ],
  },
  "packages/scam-engine/src/embeddings.ts": {
    reason: "Voyage API.",
    calls: [
      "return await fetch(url, {",
    ],
  },
  "packages/scam-engine/src/geolocate.ts": {
    reason: "ip-api.com; IP is a path segment on a fixed host.",
    calls: [
      "const res = await fetch(",
    ],
  },
  "packages/scam-engine/src/hibp.ts": {
    reason: "Have I Been Pwned API.",
    calls: [
      "const res = await fetch(",
      "res = await fetch(",
    ],
  },
  "packages/scam-engine/src/hive-ai.ts": {
    reason: "Hive API (image bytes uploaded to a fixed host).",
    calls: [
      "const res = await fetch(HIVE_API_URL, {",
    ],
  },
  "packages/scam-engine/src/inngest/shopfront-nrd-daily-ingest.ts": {
    reason: "whoisds NRD download (fixed host, date-built path) and Telegram Bot API; both via ssrfSafeDispatcher.",
    calls: [
      "import { fetch as undiciFetch } from \"undici\";",
      "import { fetch as undiciFetch } from \"undici\";",
      "const res = await undiciFetch(url, {",
      "const res = await undiciFetch(",
    ],
  },
  "packages/scam-engine/src/ipqualityscore.ts": {
    reason: "IPQualityScore API.",
    calls: [
      "const res = await fetch(",
    ],
  },
  "packages/scam-engine/src/news-intel/acsc-fetch.ts": {
    reason: "cyber.gov.au RSS (fixed feed URL).",
    calls: [
      "const resp = await fetch(url, {",
    ],
  },
  "packages/scam-engine/src/phone-footprint/providers/leakcheck.ts": {
    reason: "LeakCheck API.",
    calls: [
      "const res = await fetch(url, {",
    ],
  },
  "packages/scam-engine/src/phone-footprint/providers/vonage.ts": {
    reason: "Vonage APIs.",
    calls: [
      "const res = await fetch(VONAGE_NI_URL, {",
      "const res = await fetch(VONAGE_SIM_SWAP_URL, {",
      "const res = await fetch(VONAGE_DEVICE_SWAP_URL, {",
    ],
  },
  "packages/scam-engine/src/providers/apivoid.ts": {
    reason: "APIVoid API; domain is a query param.",
    calls: [
      "const res = await fetch(APIVOID_SITE_TRUST_URL, {",
    ],
  },
  "packages/scam-engine/src/providers/jev.ts": {
    reason: "TypeSafe Jev API.",
    calls: [
      "res = await fetch(JEV_ENDPOINT, {",
    ],
  },
  "packages/scam-engine/src/push-sender.ts": {
    reason: "Expo push API.",
    calls: [
      "const res = await fetch(EXPO_PUSH_URL, {",
    ],
  },
  "packages/scam-engine/src/rdap-bootstrap.ts": {
    reason: "IANA RDAP bootstrap file (data.iana.org).",
    calls: [
      "const res = await fetch(BOOTSTRAP_URL, {",
    ],
  },
  "packages/scam-engine/src/rdap.ts": {
    reason: "RDAP registry servers named by the IANA bootstrap (isPrivateURL-checked); domain is a path segment.",
    calls: [
      "const res = await fetch(url, {",
    ],
  },
  "packages/scam-engine/src/rerank.ts": {
    reason: "Voyage rerank API.",
    calls: [
      "const res = await fetch(\"https://api.voyageai.com/v1/rerank\", {",
    ],
  },
  "packages/scam-engine/src/safebrowsing.ts": {
    reason: "Google Safe Browsing + VirusTotal APIs (fixed hosts); checked URLs travel in the request body / as a hashed id.",
    calls: [
      "const res = await fetch(",
      "const res = await fetch(",
    ],
  },
  "packages/scam-engine/src/urlscan-search.ts": {
    reason: "urlscan.io search API.",
    calls: [
      "const res = await fetch(",
    ],
  },
  "packages/scam-engine/src/urlscan.ts": {
    reason: "urlscan.io submit/result API (urlscan fetches the target, not us).",
    calls: [
      "res = await fetch(\"https://urlscan.io/api/v1/scan/\", {",
      "const res = await fetch(`https://urlscan.io/api/v1/result/${uuid}/`, {",
    ],
  },
  "packages/scam-engine/src/whois.ts": {
    reason: "WHOIS API provider.",
    calls: [
      "const res = await fetch(",
    ],
  },
  "packages/site-audit/src/checks/dnssec.ts": {
    reason: "DNS-over-HTTPS resolver (fixed provider); domain is a query param.",
    calls: [
      "const res = await fetch(url, {",
    ],
  },
  "packages/extension-audit/src/scanner.ts": {
    reason: "Google CRX endpoint (clients2.google.com); extension id is query-encoded; only Google issues the redirect.",
    calls: [
      "const res = await fetch(url, { signal: AbortSignal.timeout(15000) });",
    ],
  },
  "packages/mcp-audit/src/scanner.ts": {
    reason: "npm registry (package name URL-encoded into the path) and OSV API — fixed hosts.",
    calls: [
      "const res = await fetch(`https://registry.npmjs.org/${encoded}`, {",
      "const res = await fetch(\"https://api.osv.dev/v1/querybatch\", {",
    ],
  },
  "apps/web/lib/axiom-query.ts": {
    reason: "Axiom query API.",
    calls: [
      "const res = await fetch(AXIOM_APL_URL, {",
    ],
  },
  "apps/web/lib/bot-message-processor.ts": {
    reason: "Telegram Bot API.",
    calls: [
      "await fetch(url, {",
    ],
  },
  "apps/web/lib/bots/messenger/api.ts": {
    reason: "Meta Graph API (Messenger send).",
    calls: [
      "const response = await fetch(url, {",
    ],
  },
  "apps/web/lib/bots/whatsapp/api.ts": {
    reason: "Meta Graph API (WhatsApp send).",
    calls: [
      "const response = await fetch(url, {",
    ],
  },
  "apps/web/lib/bots/whatsapp/media.ts": {
    reason: "Meta Graph API; the download URL is returned by Graph for a signature-verified media id.",
    calls: [
      "const metaResponse = await fetch(",
      "const downloadResponse = await fetch(mediaInfo.url, {",
    ],
  },
  "apps/web/lib/clone-watch/netcraft-issue-report.ts": {
    reason: "Netcraft report API.",
    calls: [
      "const res = await fetch(",
    ],
  },
  "apps/web/lib/clone-watch/netcraft-report.ts": {
    reason: "Netcraft report API.",
    calls: [
      "res = await fetch(",
    ],
  },
  "apps/web/lib/clone-watch/netcraft-urls.ts": {
    reason: "Netcraft report API.",
    calls: [
      "const subRes = await fetch(`${NETCRAFT_API_BASE}/submission/${encoded}`, {",
      "const urlsRes = await fetch(",
    ],
  },
  "apps/web/lib/ghost-admin.ts": {
    reason: "Ghost Admin API at an operator-configured URL.",
    calls: [
      "const res = await fetch(`${apiUrl}/ghost/api/admin/posts/?source=html`, {",
    ],
  },
  "apps/web/lib/hooks/useMediaAnalysis.ts": {
    reason: "Browser → our own /api routes (one template path) and the upload URL our own /api/media/upload returns.",
    calls: [
      "const res = await fetch(`/api/media/status?jobId=${jobId}`);",
      "const putRes = await fetch(uploadUrl, {",
    ],
  },
  "apps/web/lib/linkedin/client.ts": {
    reason: "LinkedIn API.",
    calls: [
      "const res = await fetch(OAUTH, {",
      "const initRes = await fetch(`${REST}/documents?action=initializeUpload`, {",
      "const putRes = await fetch(uploadUrl, {",
      "const res = await fetch(`${REST}/posts`, {",
      "const res = await fetch(`${REST}/posts`, {",
      "const res = await fetch(",
      "res = await fetch(`${REST}/posts/${encodeURIComponent(opts.postUrn)}`, {",
      "const dres = await fetch(`${REST}/documents/${encodeURIComponent(documentUrn)}`, {",
      "const lres = await fetch(",
      "const res = await fetch(`${REST}/posts`, {",
    ],
  },
  "apps/web/lib/newsletter/delivery.ts": {
    reason: "Resend API.",
    calls: [
      "const response = await fetch(\"https://api.resend.com/emails\", {",
      "const response = await fetch(\"https://api.resend.com/emails\", {",
    ],
  },
  "apps/web/lib/newsletter-subscription.ts": {
    reason: "Resend audiences API.",
    calls: [
      "const response = await fetch(\"https://api.resend.com/emails\", {",
    ],
  },
  "apps/web/lib/resembleDetect.ts": {
    reason: "Resemble API.",
    calls: [
      "const createRes = await fetch(`${RESEMBLE_API}/intelligence`, {",
      "const pollRes = await fetch(`${RESEMBLE_API}/intelligence/${item.uuid}`, {",
    ],
  },
  "apps/web/lib/social-publish.ts": {
    reason: "Social platform publish APIs.",
    calls: [
      "const res = await fetch(url, {",
      "const res = await fetch(\"https://api.linkedin.com/v2/ugcPosts\", {",
      "const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {",
    ],
  },
  "apps/web/app/admin/newsletter/NewsletterEditor.tsx": {
    reason: "Browser → our own /api/admin/newsletter (constant relative path in `api`).",
    calls: [
      "const response = await fetch(api, { cache: \"no-store\" });",
      "const response = await fetch(api, { method: \"POST\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify(action === \"prepare\" || action === \"refresh\" ? { action } : {",
    ],
  },
  "apps/web/app/api/admin/feeds/route.ts": {
    reason: "GitHub API workflow dispatch (fixed repo URL).",
    calls: [
      "const res = await fetch(",
    ],
  },
  "apps/web/app/api/cron/clone-lead-digest/route.ts": {
    reason: "Slack incoming-webhook URL from env.",
    calls: [
      "fetch(process.env.SLACK_WEBHOOK_LEADS_URL, {",
    ],
  },
  "apps/web/app/api/extension/_lib/turnstile.ts": {
    reason: "Cloudflare Turnstile siteverify.",
    calls: [
      "const res = await fetch(SITEVERIFY_URL, {",
    ],
  },
  "apps/web/app/api/extension/extension-security/_lib/crx-parser.ts": {
    reason: "Google CRX endpoint; extension id is query-encoded.",
    calls: [
      "const response = await fetch(url, {",
    ],
  },
  "apps/web/app/api/inngest/functions/billing-ingest-nightly.ts": {
    reason: "Billing vendor APIs.",
    calls: [
      "const res = await fetch(url, {",
      "const res = await fetch(url, {",
    ],
  },
  "apps/web/app/api/leads/route.ts": {
    reason: "Resend API.",
    calls: [
      "fetch(process.env.SLACK_WEBHOOK_LEADS_URL, {",
    ],
  },
  "apps/web/app/api/org/invite/route.ts": {
    reason: "Resend API.",
    calls: [
      "fetch(\"https://api.resend.com/emails\", {",
    ],
  },
  "apps/web/app/(marketing)/spf-compliance/SpfChecker.tsx": {
    reason: "Browser → our own route: a template path whose first segment is the literal \"/api/…\".",
    calls: [
      "const res = await fetch(`/api/site-audit/email-security?domain=${encodeURIComponent(trimmed)}`);",
    ],
  },
  "apps/web/app/admin/brand-outreach/BrandOutreach.tsx": {
    reason: "Browser → our own route: a template path whose first segment is the literal \"/api/…\".",
    calls: [
      "const res = await fetch(",
    ],
  },
  "apps/web/app/admin/brand-stewardship/BrandStewardshipDashboard.tsx": {
    reason: "Browser → our own route: a template path whose first segment is the literal \"/api/…\".",
    calls: [
      "const res = await fetch(",
      "const res = await fetch(`/api/admin/brand-stewardship/${id}/send`, {",
      "const res = await fetch(`/api/admin/brand-stewardship/${id}/preview`);",
    ],
  },
  "apps/web/app/admin/clone-watch/CloneWatchTriage.tsx": {
    reason: "Browser → our own route: a template path whose first segment is the literal \"/api/…\".",
    calls: [
      "const res = await fetch(",
    ],
  },
  "apps/web/app/admin/email-studio/EmailStudio.tsx": {
    reason: "Browser → our own route: a template path whose first segment is the literal \"/api/…\".",
    calls: [
      "const res = await fetch(`/api/admin/email-studio/${path}`, {",
    ],
  },
  "apps/web/app/app/keys/KeyList.tsx": {
    reason: "Browser → our own route: a template path whose first segment is the literal \"/api/…\".",
    calls: [
      "const res = await fetch(`/api/keys/${id}`, { method: \"DELETE\" });",
    ],
  },
  "apps/web/app/app/phone-footprint/monitors/MonitorsClient.tsx": {
    reason: "Browser → our own route: a template path whose first segment is the literal \"/api/…\".",
    calls: [
      "await fetch(`/api/phone-footprint/monitors/${monitor.id}`, {",
      "await fetch(`/api/phone-footprint/monitors/${monitor.id}`, { method: \"DELETE\" });",
    ],
  },
  "apps/web/app/phone-footprint/LookupForm.tsx": {
    reason: "Browser → our own route: a template path whose first segment is the literal \"/api/…\".",
    calls: [
      "const res = await fetch(`/api/phone-footprint/${encodeURIComponent(trimmed)}`, {",
    ],
  },
};

type Found = { file: string; site: RawFetchSite };

function walk(base: string, roots: string[]): Found[] {
  const found: Found[] = [];
  const visit = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) visit(full);
      } else if (EXT.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
        for (const site of rawFetchSites(fs.readFileSync(full, "utf8"))) {
          found.push({ file: path.relative(base, full), site });
        }
      }
    }
  };
  for (const r of roots) {
    const dir = path.join(base, r);
    if (fs.existsSync(dir)) visit(dir);
  }
  return found;
}

/** Sites not covered by the Module exemption, same-origin rule or allowlist. */
function unreviewed(found: Found[], allow: Allowlist): string[] {
  const budget = new Map<string, string[]>();
  for (const [file, e] of Object.entries(allow)) budget.set(file, [...e.calls]);
  const out: string[] = [];
  for (const { file, site } of found) {
    if (file === MODULE || site.sameOrigin) continue;
    const left = budget.get(file);
    const k = left?.indexOf(site.text) ?? -1;
    if (left && k >= 0) left.splice(k, 1);
    else out.push(`${file}:${site.line} [${site.form}] ${site.text}`);
  }
  return out;
}

function inTempTree(files: Record<string, string>, run: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raw-fetch-"));
  try {
    for (const [rel, src] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), src);
    }
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("external fetches go through safeFetch", () => {
  const found = walk(REPO, ROOTS);

  it("has no raw outbound call site outside safeFetch and the allowlist", () => {
    expect(unreviewed(found, FIXED_HOST)).toEqual([]);
  });

  it("every allowlisted call site still exists (no stale entries)", () => {
    const stale: string[] = [];
    for (const [file, e] of Object.entries(FIXED_HOST)) {
      const left = found.filter((f) => f.file === file).map((f) => f.site.text);
      for (const c of e.calls) {
        const k = left.indexOf(c);
        if (k >= 0) left.splice(k, 1);
        else stale.push(`${file}: ${c}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("the Module exists where the exemption says", () => {
    expect(fs.existsSync(path.join(REPO, MODULE))).toBe(true);
  });
});

describe("rawFetchSites — detector", () => {
  const count = (src: string) => rawFetchSites(src).filter((s) => !s.sameOrigin).length;
  const cases: Array<[string, string, number]> = [
    ["bare call", "const r = await fetch(url);", 1],
    ["multi-line", "const r = await fetch(\n  url,\n  { method: 'GET' },\n);", 1],
    ["optional call", "await fetch?.(u)", 1],
    ["generic call", "await fetch<Res>(u)", 1],
    [".call", "await fetch.call(null, u)", 1],
    ["parenthesised", "await (fetch)(u)", 1],
    ["alias", "const f = fetch; await f(u);", 1],
    ["shorthand property", "run({ fetch })", 1],
    ["globalThis.fetch", "await globalThis.fetch(u)", 1],
    ["window . fetch", "window . fetch(u)", 1],
    ['globalThis["fetch"]', 'await globalThis["fetch"](u)', 1],
    // The aliasing import is itself a reference (2 idents) plus the call.
    ["undici fetch alias", 'import { fetch as undiciFetch } from "undici";\nawait undiciFetch(u);', 3],
    ["undici.request", 'import * as undici from "undici"; await undici.request(u);', 1],
    ["undici request import", 'import { request } from "undici";', 1],
    ["https.get", 'import https from "node:https"; https.get(u, cb);', 1],
    ["http.request", "http.request(opts)", 1],
    ["node:https named import", 'import { get } from "node:https";', 1],
    ["axios", 'import axios from "axios"; await axios.get(u);', 2],
    ["got", 'const got = require("got"); await got(u);', 2],
    ["two calls", "await fetch(a); await fetch(b);", 2],
    ["regex literal does not hide code", 'const re = /[\\s"`]+/g;\nawait fetch(u);\nconst s = "x";', 1],
    ["regex with a backtick does not open a template", "const re = /`/;\nawait fetch(u);\nconst t = `x`;", 1],
    ["template expression is code", "const s = `${await fetch(u)}`;", 1],
    ["stray apostrophe in JSX text ends at the line", "<p>don't</p>\nawait fetch(u);", 1],
    ["division is not a regex", "const a = b / c; await fetch(u);", 1],
    ["method on another object is not a raw fetch", "await client.fetch(u); await sb.fetch(x)", 0],
    ["identifier containing fetch", "await safeFetch(u); prefetch(x); fetchAll(y)", 0],
    ["property key / type member", "const o = { fetch: impl }; type T = { fetch?: typeof fetch };", 0],
    ["method definition", "export default { async fetch(req) { return 1; } }", 0],
    ["step name string", 'await step.run("fetch", () => 1); await step.run("fetch-rows", f);', 0],
    ["comment", "// await fetch(u)\n/* fetch(x) */", 0],
    ["string / template text", "const s = 'fetch(u)'; const t = `fetch(${u})`;", 0],
  ];
  it.each(cases)("%s", (_label, src, want) => {
    expect(count(src)).toBe(want);
  });

  it("same-origin paths are classified; protocol-relative and variables are not", () => {
    const [a, b, c] = rawFetchSites('fetch("/api/x"); fetch("//evil.example/x"); fetch(u);');
    expect([a.sameOrigin, b.sameOrigin, c.sameOrigin]).toEqual([true, false, false]);
  });

  const sameOrigin = (src: string) => rawFetchSites(src).map((s) => s.sameOrigin);
  it.each([
    ["plain path", 'fetch("/api/x")'],
    ["plain path + init", 'fetch("/api/x", { method: "POST" })'],
    ["single quotes, spaced", "fetch( '/api/x' )"],
    ["multi-line init", 'fetch(\n  "/api/x",\n  { cache: "no-store" },\n)'],
  ])("exempts %s", (_l, src) => {
    expect(sameOrigin(src)).toEqual([true]);
  });
  it.each([
    ["backslash host", String.raw`fetch("/\\evil.com")`],
    ["escaped slash", String.raw`fetch("/\/evil.com")`],
    ["template", "fetch(`/${x}`)"],
    ["plain template", "fetch(`/api/x`)"],
    ["concatenation", 'fetch("/" + host)'],
    ["&& argument", 'fetch("/" && evil)'],
    ["ternary argument", 'fetch("/x" ? evil : 0)'],
    ["protocol-relative", 'fetch("//evil.example")'],
    ["dollar-brace in a string", 'fetch("/${x}")'],
  ])("never exempts %s", (_l, src) => {
    expect(sameOrigin(src)).toEqual([false]);
  });
});

// Go-red: each form planted in a temp tree and run through the same walker
// and allowlist check the real tree uses.
describe("go-red — planted fixtures", () => {
  const forms: Record<string, string> = {
    bare: "export const x = (u: string) => fetch(u);",
    optional: "export const x = (u: string) => fetch?.(u);",
    generic: "export const x = (u: string) => fetch<Response>(u);",
    call: "export const x = (u: string) => fetch.call(null, u);",
    paren: "export const x = (u: string) => (fetch)(u);",
    alias: "const f = fetch;\nexport const x = (u: string) => f(u);",
    globalDot: "export const x = (u: string) => globalThis.fetch(u);",
    globalIndex: 'export const x = (u: string) => globalThis["fetch"](u);',
    undiciFetch: 'import { fetch as undiciFetch } from "undici";\nexport const x = (u: string) => undiciFetch(u);',
    undiciRequest: 'import * as undici from "undici";\nexport const x = (u: string) => undici.request(u);',
    https: 'import https from "node:https";\nexport const x = (u: string) => https.get(u);',
    axios: 'import axios from "axios";\nexport const x = (u: string) => axios.get(u);',
    got: 'import got from "got";\nexport const x = (u: string) => got(u);',
    // The safebrowsing.ts shape: a regex literal holding a quote and a backtick.
    afterRegex: 'const re = /https?:\\/\\/[^\\s<>"{}|\\\\^`\\[\\]]+/gi;\nexport const x = (u: string) => fetch(u);',
    backslashPath: String.raw`export const x = () => fetch("/\\evil.com");`,
    templatePath: "export const x = (h: string) => fetch(`/${h}`);",
    concatPath: 'export const x = (h: string) => fetch("/" + h);',
    andPath: 'export const x = (h: string) => fetch("/" && h);',
    ternaryPath: 'export const x = (h: string) => fetch("/x" ? h : "");',
    afterBacktickRegex: "const re = /`/;\nexport const x = (u: string) => fetch(u);\nexport const t = `y`;",
  };
  it.each(Object.entries(forms))("flags %s", (name, src) => {
    inTempTree({ [`lib/${name}.ts`]: src }, (dir) => {
      expect(unreviewed(walk(dir, ["lib"]), {}).length).toBeGreaterThan(0);
    });
  });

  it("a second call in an allowlisted file is not exempt", () => {
    inTempTree(
      { "lib/vendor.ts": 'await fetch("https://api.vendor.example/x");\nawait fetch(userUrl);\n' },
      (dir) => {
        const allow: Allowlist = {
          "lib/vendor.ts": { reason: "fixture", calls: ['await fetch("https://api.vendor.example/x");'] },
        };
        expect(unreviewed(walk(dir, ["lib"]), allow)).toEqual([
          "lib/vendor.ts:2 [fetch] await fetch(userUrl);",
        ]);
      },
    );
  });
});
