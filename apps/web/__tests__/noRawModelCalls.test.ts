import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Every model call goes through the one untrusted-prompt Module:
// callClaudeJson (packages/scam-engine/src/anthropic.ts) or analyzeWithClaude
// (packages/scam-engine/src/claude.ts). Those are the only places that wrap
// third-party text in nonce-tagged, escaped-once blocks. A raw SDK call
// elsewhere concatenates whatever it is given straight into the prompt — how
// CVE feed text, vendor strings and persona pages reached the model
// undelimited until 2026-09-24. This walks apps/ + packages/ and fails on a
// raw `new Anthropic(` or `.messages.create(` outside the Module.

const REPO = path.join(process.cwd(), "../..");
const ROOTS = ["apps", "packages"];
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

/** Files allowed to construct the SDK client or call messages.create, each
 *  with the reason it is not a bypass. Keep this list short. */
const ALLOWED: Record<string, string> = {
  "packages/scam-engine/src/anthropic.ts":
    "callClaudeJson — the Module itself (structured untrusted blocks, schema, tool-use).",
  "packages/scam-engine/src/claude.ts":
    "analyzeWithClaude — the victim-verdict path; builds its own sandwich + nonce-wrapped redirect/theme blocks and needs assistant prefill + multi-image parts.",
  "apps/web/app/admin/showcase/showcase-data.ts":
    "Not a call: a code sample rendered as text on the admin showcase page.",
};

const RAW_CALL = /\bnew\s+Anthropic\s*\(|\.messages\.create\s*\(/;

function violations(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (
        /\.(ts|tsx|js|mjs)$/.test(e.name) &&
        !/\.(test|spec)\.[tj]sx?$/.test(e.name)
      ) {
        const rel = path.relative(REPO, full);
        if (ALLOWED[rel]) continue;
        if (RAW_CALL.test(fs.readFileSync(full, "utf8"))) out.push(rel);
      }
    }
  };
  for (const r of ROOTS) {
    const dir = path.join(REPO, r);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

describe("model calls go through the untrusted-prompt Module", () => {
  it("has no raw SDK call outside callClaudeJson / analyzeWithClaude", () => {
    expect(violations()).toEqual([]);
  });

  it("every allowlisted file still exists (no stale exemptions)", () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(fs.existsSync(path.join(REPO, rel)), rel).toBe(true);
    }
  });

  it("the walker actually finds the Module (not walking the wrong tree)", () => {
    const src = fs.readFileSync(
      path.join(REPO, "packages/scam-engine/src/anthropic.ts"),
      "utf8",
    );
    expect(RAW_CALL.test(src)).toBe(true);
  });
});
