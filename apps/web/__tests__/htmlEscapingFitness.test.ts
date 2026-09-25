import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Fitness function for the ONE HTML-escaping Module (packages/utils/src/html.ts).
// Before it existed ~21 private escapers disagreed about which characters they
// escaped (most skipped `"` and `'`, so attribute safety depended on which
// file you were in). This walks every TS source in apps/ and packages/ and
// fails when:
//   1. a private escaper is defined — by name, or by the `&` → `&amp;`
//      replace-chain that every copy was built from (catches renamed copies);
//   2. `dangerouslySetInnerHTML={{ __html: JSON.stringify(…) }}` appears — the
//      JSON-LD breakout shape; use jsonLdScript() from lib/json-ld.ts.

const REPO = path.join(process.cwd(), "../..");
const ROOTS = ["apps", "packages"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  "__tests__",
  "test",
  ".output",
  ".wxt",
]);

/** Files allowed to contain an escaping replace-chain, each with its reason. */
const ESCAPER_ALLOWLIST: Record<string, string> = {
  "packages/utils/src/html.ts": "the shared Module itself",
  "apps/extension/src/lib/image-check-card.ts":
    "renderImageCheckCard is serialized by chrome.scripting.executeScript({ func }) and must be self-contained — it cannot import",
  "packages/scam-engine/src/claude.ts":
    "escapeXml delimits untrusted text inside model prompts (the untrusted-prompt Module), not HTML output",
};

const ENTITY = String.raw`(&amp;|&lt;|&gt;|&quot;|&#0*39;|&#x0*27;|&apos;)`;
const PRIVATE_ESCAPER = [
  // named private escapers
  /\bfunction\s+(escapeHtml|escapeHTML|escHtml|htmlEscape|esc)\s*\(/,
  /\b(const|let|var)\s+(escapeHtml|escapeHTML|escHtml|htmlEscape|esc)\s*=\s*(\(|function\b|\w+\s*=>)/,
  // a replace/replaceAll whose REPLACEMENT is an HTML entity string literal
  // (any regex form, any flags — the entity is what makes it an escaper)
  new RegExp(String.raw`\.replace(All)?\s*\([^;]{0,200}?,\s*["'\`]` + ENTITY + String.raw`["'\`]`),
  // an entity lookup table: { "<": "&lt;", ... } in any key order
  new RegExp(String.raw`["'\`][&<>"']["'\`]\s*:\s*["'\`]` + ENTITY + String.raw`["'\`]`),
  // a char-class regex over HTML metacharacters fed to replace (any order, any flags)
  /\.replace(All)?\s*\(\s*\/\[(?=[^\]]*[&<>])(?=[^\]]*[<>"'])[^\]]*\]\/[gimsuyd]*\s*,/,
  /new\s+RegExp\s*\(\s*["'`]\[(?=[^\]]*[&<>])(?=[^\]]*[<>"'])[^\]]*\]/,
  // the DOM trick: textContent = … then read .innerHTML (escapes no quotes)
  /\.textContent\s*=[^;]*;[\s\S]{0,120}?\.innerHTML\b(?!\s*=)/,
];
const RAW_JSON_SCRIPT = /__html:\s*JSON\.stringify\(/;

/** Walk `roots` under `base`; `rel` is relative to `base`. */
function walkSources(base: string, roots: string[]): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.test\.[cm]?[tj]sx?$/.test(e.name)) {
        out.push({
          rel: path.relative(base, full).split(path.sep).join("/"),
          src: fs.readFileSync(full, "utf8"),
        });
      }
    }
  };
  for (const r of roots) {
    const dir = path.join(base, r);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

function sources(): { rel: string; src: string }[] {
  return walkSources(REPO, ROOTS);
}

export function privateEscapers(files: { rel: string; src: string }[]): string[] {
  return files
    .filter((f) => !(f.rel in ESCAPER_ALLOWLIST))
    .filter((f) => PRIVATE_ESCAPER.some((re) => re.test(f.src)))
    .map((f) => f.rel);
}

export function rawJsonScripts(files: { rel: string; src: string }[]): string[] {
  return files.filter((f) => RAW_JSON_SCRIPT.test(f.src)).map((f) => f.rel);
}

describe("HTML escaping fitness", () => {
  const files = sources();

  it("scans the real tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.rel === "packages/utils/src/html.ts")).toBe(true);
  });

  it("no private HTML escaper outside the shared Module", () => {
    expect(privateEscapers(files)).toEqual([]);
  });

  it("no raw JSON.stringify into __html (use jsonLdScript)", () => {
    expect(rawJsonScripts(files)).toEqual([]);
  });

  it("every allowlisted file still exists (no stale exemptions)", () => {
    for (const rel of Object.keys(ESCAPER_ALLOWLIST)) {
      expect(fs.existsSync(path.join(REPO, rel)), rel).toBe(true);
    }
  });

  // Go-red: every detector shape, planted as real files in a temp tree and
  // found by the same walker (so extension coverage is exercised too).
  const PLANTED: Record<string, string> = {
    "apps/a/named.ts": "export function escapeHtml(s: string) { return s; }",
    "apps/a/arrow.mjs": "export const esc = (s) => s;",
    "apps/a/replace.js": 'export const f = (s) => s.replace(/</g, "&lt;");',
    "apps/a/replaceAll.cjs": 'module.exports = (s) => s.replaceAll("\\"", "&quot;");',
    "apps/a/regexp.ts": 'export const f = (s: string) => s.replace(new RegExp("\\x27", "gu"), "&#39;");',
    "apps/a/classOrder.ts": "export const f = (s: string, m: (c: string) => string) => s.replace(/[<\"&>]/gu, m);",
    "apps/a/newRegExpClass.ts": 'export const re = new RegExp("[>&<]", "g");',
    "apps/a/table.ts": 'export const T = { ">": "&gt;", "&": "&amp;" };',
    "apps/a/dom.ts":
      'export function f(s: string) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }',
    "apps/a/jsonld.tsx": "export const X = <script dangerouslySetInnerHTML={{ __html: JSON.stringify({}) }} />;",
    "apps/a/ok.ts": 'import { escapeHtml } from "@askarthur/utils/html";\nexport const y = escapeHtml("<");',
    "apps/a/decode.ts": 'export const d = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<");',
  };

  it("flags every planted escaper shape and raw JSON-LD, and nothing benign", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "html-fitness-"));
    try {
      for (const [rel, src] of Object.entries(PLANTED)) {
        fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
        fs.writeFileSync(path.join(tmp, rel), src);
      }
      const planted = walkSources(tmp, ["apps"]);
      expect(planted).toHaveLength(Object.keys(PLANTED).length);
      expect(privateEscapers(planted).sort()).toEqual(
        [
          "apps/a/named.ts",
          "apps/a/arrow.mjs",
          "apps/a/replace.js",
          "apps/a/replaceAll.cjs",
          "apps/a/regexp.ts",
          "apps/a/classOrder.ts",
          "apps/a/newRegExpClass.ts",
          "apps/a/table.ts",
          "apps/a/dom.ts",
        ].sort(),
      );
      expect(rawJsonScripts(planted)).toEqual(["apps/a/jsonld.tsx"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
