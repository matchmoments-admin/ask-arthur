// Regenerates src/short-brand-neighbour-words.ts — the ordinary words that sit
// one edit away from a FIVE-character watchlist token (#1150, matcher v5).
//
// Why only the neighbourhood, not a whole dictionary: the matcher runs ~70k
// times a day and the only question it asks is "is this near-miss label an
// ordinary word?" for labels already one edit from a 5-char token. Every such
// label is in the enumerable 1-edit neighbourhood of those tokens (~400 strings
// per token), so the full answer is the dictionary INTERSECTED with that
// neighbourhood — a few hundred words, reviewable in a diff, O(1) Set lookup,
// no bundled 50k-line asset.
//
// Sources used for the committed file (2026-09-27), with the SHA-256 of the
// exact bytes read:
//   - hermitdave/FrequencyWords en_50k.txt (2018 OpenSubtitles, CC-BY-SA-4.0)
//     https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
//     sha256 5351ff405b1126ef555791dd4d9798a48e3e9a501a9fc481a9da957752cfb458
//     — carries plurals and given/surnames (bands, codes, logan, hogan)
//   - /usr/share/dict/web2 (Webster's 2nd, macOS 26.2)
//     sha256 be41ad97963bf8dabedd5871d5d691596175269d540956b0f9965a885c2bbab9
//     — plus the naive plural `<word>s`, since web2 has no plurals (gond → gonds)
//   - /usr/share/dict/propernames (macOS 26.2)
//     sha256 626d634b40b1ad9257d0e4f16e155ea87d258dd458e9ccf94fb84bb1b63e585a
//   - SUPPLEMENT below — Australian and foreign words the lists above miss
//
// REPRODUCIBILITY — stated plainly: the inputs are NOT pinned in the repo.
// The macOS dictionaries differ between OS releases and do not exist on Linux
// CI, and the FrequencyWords file is fetched from GitHub. Regenerating on
// another machine can therefore produce a different list; compare the hashes
// above first. There is deliberately no "committed file == generator output"
// test for that reason. What IS checked in CI (lexical-match-v5.test.ts G5/G11):
// every 5-char token is covered, every committed word really is one edit from
// a covered token, and every SUPPLEMENT word is in the committed list.
//
// Usage (from the repo root):
//   pnpm --filter @askarthur/web exec tsx ../../packages/shopfront-glue/scripts/gen-short-brand-neighbour-words.ts \
//     <en_50k.txt> /usr/share/dict/web2 /usr/share/dict/propernames
//
// A new 5-char brand or alias on the watchlist makes the covered-token guard in
// lexical-match-v5.test.ts go red until this is re-run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AU_BRAND_WATCHLIST } from "../src/au-brand-watchlist";

/**
 * Words the general lists miss. Exported so a test can pin them in the output.
 *
 *  - Australian: `bondi` is the matcher's own canonical FP (see the
 *    lexical-match.ts header); `cowes` (Phillip Island, VIC) reached the v5
 *    harness as a Coles hit.
 *  - Foreign / brandable, in the neighbourhood of an OPEN brand (#1262 review,
 *    D3). Hand-picked from the FrequencyWords fr/de/nl/sv/da/no 50k lists
 *    (same repo and date as en_50k): appli (fr), appele (fr), applen / applet
 *    (sv), bonde (fr bondé, sv/da/no "farmer"), bondo (sv/da/no); plus bondy
 *    (a French commune) and bondu, named in the review.
 *
 * NOT the whole foreign lists: nl_50k contains `appie` — Albert Heijn's app —
 * and appie.{bond,beer,autos,mom,beauty} is a CONFIRMED Apple campaign. A
 * whole-list import would silently re-lose five threats. Curate; re-measure.
 */
export const SUPPLEMENT = [
  "bondi", "cowes",
  "appli", "appele", "applen", "applet",
  "bonde", "bondo", "bondy", "bondu",
];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-";

function neighbours(token: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= token.length; i++) {
    for (const c of ALPHABET) out.add(token.slice(0, i) + c + token.slice(i)); // insertion
  }
  for (let i = 0; i < token.length; i++) {
    out.add(token.slice(0, i) + token.slice(i + 1)); // deletion
    for (const c of ALPHABET) out.add(token.slice(0, i) + c + token.slice(i + 1)); // substitution
  }
  out.delete(token);
  return out;
}

function loadWords(files: string[]): Set<string> {
  const words = new Set<string>(SUPPLEMENT);
  for (const f of files) {
    const isWeb2 = path.basename(f) === "web2";
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const w = (line.split(/\s+/)[0] ?? "").toLowerCase();
      if (!/^[a-z]+$/.test(w)) continue;
      words.add(w);
      if (isWeb2) words.add(`${w}s`);
    }
  }
  return words;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error("usage: gen-short-brand-neighbour-words.ts <wordlist>...");
  const words = loadWords(files);

  const tokens = new Set<string>();
  for (const e of AU_BRAND_WATCHLIST) {
    for (const t of [e.brand, ...(e.aliases ?? [])]) {
      const n = t.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (n.length === 5) tokens.add(n);
    }
  }
  const covered = [...tokens].sort();
  const hits = new Set<string>();
  for (const t of covered) for (const n of neighbours(t)) if (words.has(n)) hits.add(n);
  const sorted = [...hits].sort();

  const lines: string[] = [];
  for (let i = 0; i < sorted.length; i += 10) {
    lines.push("  " + sorted.slice(i, i + 10).map((w) => JSON.stringify(w)).join(", ") + ",");
  }
  const out = `// GENERATED by packages/shopfront-glue/scripts/gen-short-brand-neighbour-words.ts
// — do not hand-edit; re-run the script (its header lists the word sources).
//
// Ordinary words exactly one edit from a 5-character watchlist token. The v5
// short-brand recovery paths in lexical-match.ts never match a label in this
// set: it is the precision floor that keeps bonus/bands/mart/bank/stage dead
// while non-word squats (appie, bonos, bnds, b0nds) are recovered (#1150).

/** The 5-char tokens this list was generated for. The covered-token guard in
 *  lexical-match-v5.test.ts fails when the watchlist gains one that is not here. */
export const NEIGHBOUR_WORDS_COVERED_TOKENS: readonly string[] = ${JSON.stringify(covered)};

export const SHORT_BRAND_NEIGHBOUR_WORDS: ReadonlySet<string> = new Set([
${lines.join("\n")}
]);
`;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, "..", "src", "short-brand-neighbour-words.ts");
  fs.writeFileSync(target, out);
  console.log(`${covered.length} tokens, ${sorted.length} words → ${target}`);
}

// Run only as a script: the test imports SUPPLEMENT from this file.
if (process.argv[1]?.includes("gen-short-brand-neighbour-words")) main();
