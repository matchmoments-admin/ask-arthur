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
import { splitBrandLabel } from "./brand-label";

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

/**
 * Build the RECALL-oriented resolver: a free-text classifier label → every
 * distinct `canonical_brand` any part of it resolves to. Empty array when
 * nothing resolves.
 *
 * WHY THIS IS A SECOND ADAPTER AND NOT A WIDER buildBrandResolver
 * --------------------------------------------------------------
 * The two live callers of buildBrandResolver ask a PRECISION question — "which
 * brand IS this?" — and act on a single answer:
 *
 *   report-brand-stewardship  matchKnownBrand() picks the security contact the
 *                             stewardship mail is SENT to. A wrong resolution
 *                             emails the wrong company's phishing desk.
 *   brand-register-refresh    canonicalFor() folds 30-day counts onto a brand's
 *                             row. A wrong resolution attributes someone else's
 *                             scam volume to that brand.
 *
 * The already-watched gate in reddit-brands-discover asks a different, RECALL
 * question — "is ANY part of this a brand we already watch?" — where an extra
 * match costs a suppressed queue row and a missed match costs a false
 * "brand-new" proposal to the operator (the NAB leak, 2026-08-24).
 *
 * One resolver cannot serve both: widening the single-answer form to satisfy
 * the gate would silently change which security desk receives mail. So the
 * Seam gets a second Adapter over the SAME alias snapshot, and
 * buildBrandResolver stays byte-identical for the outward-facing paths.
 *
 * Hedged labels ("Generic cloud storage provider (possibly …/iCloud)") return
 * `[]` — see isNonBrandLabel. Load the alias record ONCE per run, as with
 * buildBrandResolver.
 */
export function buildBrandMultiResolver(
  aliasRecord: BrandAliasRecord,
): (raw: string | null | undefined) => string[] {
  return (raw) => {
    const out: string[] = [];
    for (const part of splitBrandLabel(raw)) {
      const k = brandNormalize(part);
      if (!k) continue;
      const canonical = aliasRecord[k];
      if (canonical && !out.includes(canonical)) out.push(canonical);
    }
    return out;
  };
}
