// Canonical brand-name join key — the runtime (TypeScript) twin of the SQL
// public.brand_normalize(text) shipped in
// supabase/migration-v174-canonical-brand-alias-layer.sql, and of the
// build-time copy in scripts/gen-brand-aliases-seed.mjs.
//
// All three MUST stay byte-identical: lowercase, then strip everything but
// [a-z0-9]. Empty/whitespace-only/symbol-only input normalises to null (the
// SQL form returns NULL via NULLIF). A test in __tests__ asserts this TS copy
// matches the .mjs copy across the whole AU brand watchlist.
//
// Used to resolve a free-text brand mention to its canonical brand against the
// brand_aliases lookup (keyed by alias_normalized) without a DB round-trip per
// brand — load the table once, then `aliasMap.get(brandNormalize(raw))`.
export function brandNormalize(raw: string | null | undefined): string | null {
  const k = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return k.length ? k : null;
}
