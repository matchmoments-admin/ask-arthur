// Read-side canonical-brand resolver — the Module half of the canonical
// brand-key Seam (see docs/plans/brand-convergence-seam.md, Phase 0).
//
// The v174 brand_aliases layer maps a normalized brand token
// (alias_normalized = brandNormalize(raw)) to ONE canonical_brand. This file
// concentrates the resolver closure that was previously copy-pasted verbatim in
// reddit-brands-discover.ts and report-brand-stewardship.ts.
//
// It stays a PURE function over a bulk-loaded snapshot so this package keeps its
// zero-Supabase-dependency purity — the Supabase-backed loader that produces the
// BrandAliasRecord lives app-side (apps/web/lib/brand-aliases.ts loadAliasRecord).
import { brandNormalize } from "./brand-normalize";

/**
 * A bulk-loaded snapshot of the v174 `brand_aliases` table:
 * `alias_normalized` (= `brandNormalize(raw)`) → `canonical_brand`.
 *
 * A plain Record (not a Map) so it survives Inngest `step.run` JSON
 * serialisation — the reason both original call sites paged into a Record.
 */
export type BrandAliasRecord = Record<string, string>;

/**
 * Build the read-side canonical-brand resolver over a bulk-loaded alias record.
 * Returns a closure: a free-text brand mention → its `canonical_brand`, or
 * `null` when the mention normalises to nothing OR isn't in the alias layer.
 *
 * Load the alias record ONCE per run (a DB round-trip per brand is the
 * anti-pattern this replaces), then call the returned resolver per mention.
 */
export function buildBrandResolver(
  aliasRecord: BrandAliasRecord,
): (raw: string | null | undefined) => string | null {
  return (raw) => {
    const k = brandNormalize(raw);
    return k ? (aliasRecord[k] ?? null) : null;
  };
}
