// Brand-label parsing — the missing half of the canonical brand-key Seam
// (CONTEXT.md "Canonical Brand", ADR-0020).
//
// THE PROBLEM THIS MODULE EXISTS FOR
// ----------------------------------
// brandNormalize() is exact and whole-string by design: lowercase, strip to
// [a-z0-9]. That is correct for a brand NAME. But two of the three streams feed
// it a free-text LABEL written by a Claude classifier, and a label is not a
// name — it is prose that happens to contain one:
//
//   "NAB (National Australia Bank)"      -> nabnationalaustraliabank
//   "Linkt / Transurban (toll operators)" -> linkttransurbantolloperators
//
// Both brands are already monitored. Neither key matches anything, because the
// parenthetical and the slash are part of the string being normalised. The
// already-watched gate is exact set membership, so a near-miss is
// indistinguishable from an unknown brand and the brand is proposed to the
// operator as brand-new.
//
// Measured against prod 2026-08-27: 23 of 44 labelled scam_reports (52%) carry
// a "(", "/" or "," . Of 20 distinct compound labels only 5 resolved
// whole-string — and all five resolved only because an earlier leak had already
// been point-fixed with a brand_aliases row (v260 "Australian Tax Office
// (ATO)", v261 "eBay Australia", plus myGov/Instagram/Meta/Apple).
//
// That is the pattern this replaces. Seeding one alias row per variant treats
// each leak as a data gap; it is a parsing gap, and the classifier can invent a
// new phrasing any week. This Module reads the label instead.
//
// WHY THE HEDGE GATE IS THE LOAD-BEARING HALF
// -------------------------------------------
// Splitting alone is not safe. The same prod capture contains
//
//   "Generic cloud storage provider (possibly Google Drive/OneDrive/iCloud)"
//
// which splits out "iCloud" and would resolve, confidently, to Apple — on a
// label whose own words say the classifier could not identify the brand. A
// label that hedges must resolve to NOTHING, not to whichever fragment happens
// to be aliased. isNonBrandLabel() is checked BEFORE any fragment is offered.
//
// Pure — no DB, no Supabase import — so it stays inside this package's
// zero-dependency contract, same rule as brand-resolver.ts.

/**
 * Separator characters that join a brand name to surrounding prose in a
 * classifier label: parentheses, slash, comma, and a spaced hyphen.
 *
 * A bare "-" is deliberately NOT a separator — "Jetstar-Qantas" and
 * "Bendigo-Adelaide" are single names, and splitting them produces fragments
 * that are brands in their own right, which is exactly how a wrong attribution
 * gets made. Only " - " (spaced) reads as punctuation.
 */
const FRAGMENT_SPLIT = /\s+-\s+|[/(),]/;

/**
 * Words that mark a label as a DESCRIPTION of an unidentified brand rather than
 * a brand name. Their presence anywhere in the label disqualifies the whole
 * label, including every fragment inside it.
 *
 * Drawn from the live prod capture — each entry below appears in a real
 * scam_reports.impersonated_brand value:
 *
 *   "Generic cloud storage provider (possibly Google Drive/OneDrive/iCloud)"
 *   "Generic financial/rewards app (impersonation of legitimate fintech…)"
 *   "Generic health insurance provider (OFHC or similar)"
 *   "Designer goods retailers (generic impersonation)"
 *   "Coastal Rescue Foundation (potentially)"
 *   "Australian Bushfire Relief Foundation (unverified)"
 *
 * Matched on word boundaries so "genuine" does not trip "generic" and a brand
 * legitimately containing one of these strings is not caught by substring luck.
 */
const HEDGE_MARKERS: readonly string[] = [
  "generic",
  "possibly",
  "potentially",
  "unverified",
  "unknown",
  "unidentified",
  "or similar",
  "impersonation of",
  "impersonating",
];

const HEDGE_RE = new RegExp(
  `(^|\\W)(${HEDGE_MARKERS.map((m) => m.replace(/\s+/g, "\\s+")).join("|")})(\\W|$)`,
  "i",
);

/**
 * True when the label describes an unidentified brand rather than naming one.
 *
 * Callers must treat this as "resolves to nothing" and NOT fall back to
 * fragment matching — the hedge is the classifier telling us it does not know,
 * and a fragment lifted out of a hedged label is a confident wrong answer.
 */
export function isNonBrandLabel(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  return HEDGE_RE.test(s);
}

/**
 * Split a free-text classifier label into the brand-name candidates it may
 * contain, most specific first.
 *
 * Ordering is WHOLE STRING FIRST, then fragments longest-first. That order is
 * the contract, not an implementation detail: the whole string is the only
 * candidate that can be an exact brand name, so an existing whole-string alias
 * (the v260/v261 rows already in prod) always wins over a fragment. Fragments
 * are longest-first so "National Australia Bank" is offered before "NAB" —
 * both resolve, but the longer form is the more specific claim.
 *
 * Returns `[]` for a hedged label (see isNonBrandLabel), for null/empty input,
 * and for input that is only punctuation. De-duplicated, case-preserved
 * (normalisation is the caller's job — this Module does not know about
 * brandNormalize's key convention).
 */
export function splitBrandLabel(raw: string | null | undefined): string[] {
  const whole = String(raw ?? "").trim();
  if (!whole) return [];
  // Punctuation-only input carries no brand. Bailing here rather than letting
  // it through keeps the unresolved-label telemetry honest — "///" is not a
  // label the classifier failed to resolve, it is not a label at all.
  if (!/[a-z0-9]/i.test(whole)) return [];
  if (isNonBrandLabel(whole)) return [];

  const fragments = whole
    .split(FRAGMENT_SPLIT)
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    // A single trailing "Inc." / "Ltd" fragment carries no brand identity and
    // would resolve to nothing anyway; dropping it keeps the list readable in
    // the unresolved-label telemetry.
    .filter((f) => !/^(inc|inc\.|ltd|ltd\.|pty|plc|llc)$/i.test(f))
    .sort((a, b) => b.length - a.length);

  const out: string[] = [whole];
  for (const f of fragments) if (!out.includes(f)) out.push(f);
  return out;
}
