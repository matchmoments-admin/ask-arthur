import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A parameter that a caller passes and the callee discards is a distinction the
// caller went to the trouble of expressing, thrown away in silence.
//
// The underscore prefix is what makes it silent. `no-unused-vars` is configured
// with `argsIgnorePattern: "^_"` (packages/eslint-config/base.js) — deliberate,
// and load-bearing for genuine discards — so an underscore converts the one
// automated signal into nothing. Two further gaps compound it: lint runs at
// `warn` with no `--max-warnings 0`, and only 1 of 17 workspaces has a lint
// script, so `packages/**` is never checked at all.
//
// WHAT THIS COST. `getScamTypeBreakdown(_days = 30)` in lib/dashboard.ts accepted
// a window, ignored it, and the /app dashboard captioned the result "Last 30
// days" plus a "30d" chip. All-time data under a one-month claim, on a live
// page. The signature was right, the caller was right, the caption was correct
// English — only the behaviour was wrong, and nothing in the toolchain could see
// it.
//
// It is a class, not an instance: /api/badge accepted a `?label=` it never
// rendered, and phone-footprint-refresh collapsed six distinct terminal states
// into one undifferentiated "completed".
//
// WHAT THIS DOES NOT CATCH, stated so the coverage is not overread: a caption
// that claims a window where the function takes no window parameter at all.
// `getRecentThreats` says "Top detected this week" over an unfiltered query, and
// nothing static can correlate the words with the SQL. That stays a review
// problem — see docs/agents/defect-shapes.md.

const ROOTS = [
  path.join(__dirname, "..", "app"),
  path.join(__dirname, "..", "lib"),
  path.join(__dirname, "..", "..", "..", "packages"),
];

/**
 * Strip comments AND string literals before matching.
 *
 * The strings matter, and I learned that while building this. A first cut of the
 * companion prop check reported SectorHero as clean because the word "sector"
 * appears after its interface inside user-facing copy — "SPF Act sector codes
 * take effect 1 July 2026" — and a plain word match counted that as usage.
 * Matching source text instead of the thing is the same mistake this file is
 * about.
 */
function strip(src: string): string {
  // Block comments first, across lines — they are the only construct here that
  // legitimately spans lines and can be matched safely.
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, " ");

  // Everything else PER LINE, and that is the point rather than tidiness.
  //
  // The first version stripped template literals across the whole file with
  // /`(?:[^`\\]|\\.)*`/g. One unbalanced backtick — a multi-line template, a
  // backtick inside a regex — made it swallow 2,288 characters of
  // api/site-audit/stream/route.ts, including the `_originalUrl` declaration
  // this guard exists to find. The guard reported clean because it had eaten
  // the evidence.
  //
  // Per line, a mismatched quote can only damage its own line, and a parameter
  // declaration lives on one line. The blast radius is the bug's own line
  // instead of the rest of the file.
  return noBlock
    .split("\n")
    .map((line) =>
      line
        .replace(/\/\/[^\n]*/g, " ")
        .replace(/`(?:[^`\\]|\\.)*`/g, " ")
        .replace(/"(?:[^"\\]|\\.)*"/g, " ")
        .replace(/'(?:[^'\\]|\\.)*'/g, " "),
    )
    .join("\n");
}

/**
 * `_req` is the Next.js route-handler idiom: the signature is
 * `(_req, { params })` because only `params` is wanted. The framework supplies
 * that argument, not a caller with something to say — so nothing is discarded.
 */
const IDIOMATIC = new Set(["_req", "_"]);

/** Path -> why this discard is genuinely intended. A reason is required. */
const ALLOWLIST: Record<string, string> = {
  "apps/web/app/api/inngest/functions/clone-watch-notify-brand.ts":
    "_severity: severity gating was removed 2026-05-27 and the parameter is " +
    "retained deliberately to preserve the type contract — documented at the " +
    "declaration.",
};

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "__tests__", "dist"].includes(entry.name)) {
        continue;
      }
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const repoRoot = path.join(__dirname, "..", "..", "..");
const rel = (f: string) => path.relative(repoRoot, f);
const files = ROOTS.flatMap((r) => walk(r));

describe("a caller's distinction is not silently discarded", () => {
  it("scans a non-trivial number of files (guards a silently-empty sweep)", () => {
    // A guard that stops scanning is worse than no guard: it reports success.
    expect(files.length).toBeGreaterThan(200);
  });

  it("has no underscore-prefixed parameter outside the route-handler idiom", () => {
    const offenders = new Set<string>();
    for (const file of files) {
      if (ALLOWLIST[rel(file)]) continue;
      const src = strip(fs.readFileSync(file, "utf8"));
      for (const m of src.matchAll(/[(,]\s*(_[a-z]\w*)\s*\??\s*:/g)) {
        if (IDIOMATIC.has(m[1])) continue;
        offenders.add(`${rel(file)}  ${m[1]}`);
      }
    }
    expect(
      [...offenders],
      "These parameters are accepted from a caller and then discarded:\n" +
        [...offenders].map((o) => `  - ${o}`).join("\n") +
        "\n\nThe underscore silences no-unused-vars, so nothing else will tell " +
        "you.\nEither USE the value, REMOVE the parameter so callers stop " +
        "computing it,\nor add the file to ALLOWLIST here with a reason. Do not " +
        "simply rename it —\n`getScamTypeBreakdown(_days)` shipped a false " +
        "caption for months because an\nunderscore made it invisible.",
    ).toEqual([]);
  });
});
