import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// PostgREST caps every response at 1000 rows, server-side, with no error and no
// signal. `.limit(5000)` returns 1000. Measured against prod 2026-08-09:
//
//   .limit(5000)      -> 1000 rows
//   .range(1000,4999) ->   64 rows   (they exist, just never returned)
//
// A `.limit(N)` above 1000 is therefore always one of two things: a lie about
// how much data the caller will see, or dead decoration. Worse, the natural
// guard — `if (rows.length === N) warn()` — can never fire for N > 1000, so the
// code reads as if it were defended.
//
// THIS RULE ALREADY EXISTED IN PROSE AND STILL REGRESSED. weekly-review/page.tsx
// states it correctly; cluster-builder.ts fixed it properly by paginating; and
// clone-watch-weekly-digest.ts carried the comment "PostgREST silently caps at
// 1000 rows otherwise" directly above a `.limit(2000)` with a `=== 2000` guard.
// A correct comment is not a control. This test is the control.
//
// Fix by paging with `fetchAllRows` (packages/supabase/src/paginate.ts), or —
// when only a total is wanted — by using `count: "exact", head: true`, which is
// not capped (see lib/dashboard/read-count.ts).

const ROOTS = [
  path.join(__dirname, "..", "app"),
  path.join(__dirname, "..", "lib"),
  path.join(__dirname, "..", "scripts"),
  path.join(__dirname, "..", "..", "..", "packages"),
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "__tests__",
]);

/**
 * Call sites that may exceed 1000 with a written reason. An entry here is a
 * claim someone defends at review — not a way to silence the test.
 */
const ALLOWLIST: Record<string, string> = {};

/**
 * Blank out comments before scanning. Without this the check fires on prose —
 * including the very comments that explain the rule, and paginate.ts's own
 * worked example. Line numbering is preserved so offender output stays useful.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^(\s*)\/\/.*$/gm, (_m, indent: string) => indent);
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const REPO = path.join(__dirname, "..", "..", "..");
const rel = (f: string) => path.relative(REPO, f);

describe("no Supabase read asks for more rows than PostgREST will return", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it("scans a non-trivial number of files (guards a silently-empty sweep)", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("has no `.limit(N)` with N > 1000", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const lines = stripComments(src).split("\n");
      lines.forEach((line, i) => {
        // Numeric literals only, underscores allowed (10_000). A `.limit(CONST)`
        // is not caught here — the constant's own declaration is, if it's a
        // literal used in a limit; see the companion check below.
        const m = line.match(/\.limit\(\s*(\d[\d_]*)\s*\)/);
        if (!m) return;
        const n = Number(m[1].replace(/_/g, ""));
        if (n <= 1000) return;
        const key = `${rel(file)}:${i + 1}`;
        if (ALLOWLIST[rel(file)]) return;
        offenders.push(`${key}  .limit(${n})`);
      });
    }
    expect(
      offenders,
      `These reads ask for more rows than PostgREST will ever return (hard cap 1000),\n` +
        `so they silently truncate:\n` +
        offenders.map((o) => `  - ${o}`).join("\n") +
        `\n\nPage with fetchAllRows() from @askarthur/supabase/paginate, or use\n` +
        `{ count: "exact", head: true } if you only need a total. If a site is\n` +
        `genuinely fine, add it to ALLOWLIST in this file with a reason.`,
    ).toEqual([]);
  });

  it("has no truncation guard comparing against an unreachable constant", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      stripComments(src)
        .split("\n")
        .forEach((line, i) => {
          // `x.length === 5000` / `>= 3000` next to a fetch: a ceiling above the
          // server cap can never be reached, so the guard is decoration.
          const m = line.match(/\.length\s*(?:===|==|>=)\s*(\d[\d_]*)/);
          if (!m) return;
          const n = Number(m[1].replace(/_/g, ""));
          if (n <= 1000) return;
          offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(
      offenders,
      `These guards compare a row count against a number PostgREST can never\n` +
        `return, so they can never fire:\n` +
        offenders.map((o) => `  - ${o}`).join("\n") +
        `\n\nCompare against fetchAllRows()'s \`truncated\` flag instead.`,
    ).toEqual([]);
  });

  it("every allowlist entry names a real file and carries a reason", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(
        fs.existsSync(path.join(REPO, file)),
        `allowlisted file ${file} no longer exists — drop the entry`,
      ).toBe(true);
      expect(
        reason.length,
        `allowlist entry ${file} needs a reason`,
      ).toBeGreaterThan(20);
    }
  });
});
