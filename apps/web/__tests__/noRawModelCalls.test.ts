import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rawModelCallReasons } from "@/lib/raw-model-call-scan";

// Every model call goes through the one untrusted-prompt Module:
// callClaudeJson (packages/scam-engine/src/anthropic.ts) or analyzeWithClaude
// (packages/scam-engine/src/claude.ts). Those are the only places that wrap
// third-party text in nonce-tagged, escaped-once blocks. A raw SDK call
// elsewhere concatenates whatever it is given straight into the prompt — how
// CVE feed text, vendor strings and persona pages reached the model
// undelimited until 2026-09-24. This walks every source root and fails on a
// value import of a model SDK, the API host literal, a client construction or
// a messages call outside the Module.

const REPO = path.join(process.cwd(), "../..");
const ROOTS = ["apps", "packages", "scripts", "evals", "supabase/functions"];
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  "__tests__",
  ".output",
  ".wxt",
  ".expo",
]);

/** The Module itself — these files ARE the one place raw calls belong, so
 *  they are exempt rather than scanned. Nothing else is exempt by file: text
 *  samples (e.g. the admin showcase's code listing) pass because string and
 *  template literal contents are stripped before matching. */
const MODULE_FILES: Record<string, string> = {
  "packages/scam-engine/src/anthropic.ts":
    "callClaudeJson — structured untrusted blocks, schema, tool-use, images.",
  "packages/scam-engine/src/claude.ts":
    "analyzeWithClaude — the victim-verdict path; own sandwich + nonce-wrapped redirect/theme blocks, assistant prefill, multi-image parts.",
};

function scan(root: string, exempt: Record<string, string>): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (EXTENSIONS.test(e.name) && !/\.(test|spec)\.[cm]?[tj]sx?$/.test(e.name)) {
        const rel = path.relative(root, full);
        if (exempt[rel]) continue;
        const reasons = rawModelCallReasons(fs.readFileSync(full, "utf8"));
        if (reasons.length) out.push(`${rel}: ${reasons.join(", ")}`);
      }
    }
  };
  for (const r of ROOTS) {
    const dir = path.join(root, r);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

describe("model calls go through the untrusted-prompt Module", () => {
  it("has no raw model call outside callClaudeJson / analyzeWithClaude", () => {
    expect(scan(REPO, MODULE_FILES)).toEqual([]);
  });

  it("every exempt Module file still exists and is detected (walker sees the tree)", () => {
    for (const rel of Object.keys(MODULE_FILES)) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(rawModelCallReasons(src).length, rel).toBeGreaterThan(0);
    }
  });

  // Go-red: each forbidden form, planted in a temp tree (never the real one).
  describe("catches every forbidden form", () => {
    const planted: Record<string, string> = {
      "value-import.ts": 'import Anthropic from "@anthropic-ai/sdk";\nexport const x = 1;',
      "named-import.ts": 'import { Anthropic } from "@anthropic-ai/sdk";',
      "require.cjs": 'const A = require("@anthropic-ai/sdk");',
      "dynamic-import.mts": 'const m = await import("@anthropic-ai/sdk");',
      "ai-sdk.ts": 'import { anthropic } from "@ai-sdk/anthropic";',
      "bedrock.ts": 'import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";',
      "vertex-use.jsx": "const c = new AnthropicVertex({ region });",
      "host.ts": 'await fetch("https://api.anthropic.com/v1/messages", { method: "POST" });',
      "multiline.ts": "const r = await client.messages\n  .create({ model });",
      "stream.cts": "const s = client.messages.stream({ model });",
      "batches.ts": "await client.messages.batches.create({ requests });",
      "construct.js": "const c = new Anthropic({ apiKey });",
    };
    for (const [file, src] of Object.entries(planted)) {
      it(file, () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "raw-model-"));
        try {
          const dir = path.join(root, "packages", "fixture");
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, file), src);
          expect(scan(root, {})).toHaveLength(1);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      });
    }
  });

  it("allows type-only imports, comments and code rendered as text", () => {
    expect(rawModelCallReasons('import type Anthropic from "@anthropic-ai/sdk";')).toEqual([]);
    expect(rawModelCallReasons("// we used to call client.messages.create( here")).toEqual([]);
    expect(
      rawModelCallReasons('const sample = `const res = await claude.messages.create(...);`;'),
    ).toEqual([]);
  });
});
