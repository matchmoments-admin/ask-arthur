import { describe, expect, it } from "vitest";
import fs from "node:fs";
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

const PRIVATE_ESCAPER = [
  /\bfunction\s+(escapeHtml|escapeHTML|escHtml|htmlEscape|esc)\s*\(/,
  /\b(const|let)\s+(escapeHtml|escapeHTML|escHtml|htmlEscape|esc)\s*=\s*(\(|function\b)/,
  /\.replace\(\s*\/&\/g\s*,\s*["'`]&amp;["'`]\s*\)/,
  /\.replace\(\s*\/\[&<>/,
];
const RAW_JSON_SCRIPT = /__html:\s*JSON\.stringify\(/;

function sources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push({
          rel: path.relative(REPO, full).split(path.sep).join("/"),
          src: fs.readFileSync(full, "utf8"),
        });
      }
    }
  };
  for (const r of ROOTS) {
    const dir = path.join(REPO, r);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
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

  // The detectors themselves, against planted violations.
  it("flags a planted private escaper and a planted raw JSON script", () => {
    const planted = [
      { rel: "apps/web/x.ts", src: "function escapeHtml(s: string) { return s; }" },
      { rel: "apps/web/y.ts", src: 'const t = s.replace(/&/g, "&amp;");' },
      { rel: "apps/web/z.ts", src: "const q = s.replace(/[&<>]/g, f);" },
      { rel: "apps/web/w.tsx", src: "<script dangerouslySetInnerHTML={{ __html: JSON.stringify(x) }} />" },
      { rel: "apps/web/ok.ts", src: 'import { escapeHtml } from "@askarthur/utils/html";' },
    ];
    expect(privateEscapers(planted)).toEqual(["apps/web/x.ts", "apps/web/y.ts", "apps/web/z.ts"]);
    expect(rawJsonScripts(planted)).toEqual(["apps/web/w.tsx"]);
  });
});
