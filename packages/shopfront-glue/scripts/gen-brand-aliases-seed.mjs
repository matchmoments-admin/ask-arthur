// Regenerates the brand_aliases seed VALUES block for the canonical brand-alias
// layer (first shipped in supabase/migration-v174-canonical-brand-alias-layer.sql).
//
// The au-brand-watchlist.ts file is the source of truth for which AU brands
// clone-watch tracks; this script projects each brand + its short-form aliases
// into normalized (alias -> canonical_brand) rows so cross-source brand joins
// resolve to one canonical name. Re-seeding is a NEW migration (never an edit to
// a merged one): run `node scripts/gen-brand-aliases-seed.mjs` and paste the
// output into the new migration's INSERT ... VALUES block.
//
// Normalization MUST stay byte-identical to the SQL brand_normalize(text):
//   lowercase, then strip everything but [a-z0-9].
//
// Usage:  node packages/shopfront-glue/scripts/gen-brand-aliases-seed.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const watchlistPath = path.join(here, "..", "src", "au-brand-watchlist.ts");

/** Mirror of the SQL brand_normalize(text). Keep in lockstep. */
export function brandNormalize(raw) {
  const k = String(raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return k.length ? k : null;
}

/** Parse the AU_BRAND_WATCHLIST array literal into {brand, aliases[]} entries. */
export function parseWatchlist(ts) {
  const start = ts.indexOf("AU_BRAND_WATCHLIST");
  const arrStart = ts.indexOf("[", ts.indexOf("=", start));
  let depth = 0, end = -1;
  for (let i = arrStart; i < ts.length; i++) {
    const c = ts[i];
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = ts.slice(arrStart + 1, end);

  // Walk balanced braces so objects containing a nested `ct: { ... }` block
  // (the bank/telco/post brands) are captured, not split.
  const objs = [];
  let d = 0, s = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") { if (d === 0) s = i; d++; }
    else if (c === "}") { d--; if (d === 0 && s !== -1) { objs.push(body.slice(s, i + 1)); s = -1; } }
  }

  return objs.flatMap((o) => {
    const bm = o.match(/brand:\s*"([^"]+)"/);
    if (!bm) return [];
    const brand = bm[1];
    const aliases = [];
    const am = o.match(/aliases:\s*\[([^\]]*)\]/);
    if (am) for (const a of am[1].matchAll(/"([^"]+)"/g)) aliases.push(a[1]);
    return [{ brand, aliases }];
  });
}

/** Build the deduped (alias_normalized -> canonical_brand) map; first writer wins. */
export function buildAliasRows(entries) {
  const rows = new Map();
  const collisions = [];
  for (const { brand, aliases } of entries) {
    for (const name of [brand, ...aliases]) {
      const k = brandNormalize(name);
      if (!k) continue;
      if (rows.has(k) && rows.get(k) !== brand) { collisions.push([k, rows.get(k), brand]); continue; }
      if (!rows.has(k)) rows.set(k, brand);
    }
  }
  return { rows, collisions };
}

function toValuesSql(rows) {
  const esc = (s) => s.replace(/'/g, "''");
  return [...rows.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `  ('${esc(k)}', '${esc(v)}', 'watchlist')`)
    .join(",\n");
}

// Run as a script (no-op when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ts = fs.readFileSync(watchlistPath, "utf8");
  const entries = parseWatchlist(ts);
  const { rows, collisions } = buildAliasRows(entries);
  process.stderr.write(`brands: ${entries.length} | alias rows: ${rows.size} | collisions: ${collisions.length}\n`);
  if (collisions.length) process.stderr.write(JSON.stringify(collisions, null, 2) + "\n");
  process.stdout.write(toValuesSql(rows) + "\n");
}
