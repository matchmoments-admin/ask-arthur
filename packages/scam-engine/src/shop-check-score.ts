// Composite-risk scoring — Deep Shop Check Stage 1.
//
// A transparent additive model: each signal contributes risk points, the
// sum clamps to 0-100, higher = more concern. Deliberately explainable
// (not an opaque ML score) — the research names "transparent explanations"
// as Ask Arthur's competitive route vs. blocklist-driven competitors.
//
// Weights: domain age and an APIVoid "risky" verdict share the +35 ceiling
// (domain age is the strongest single tell in the published research; an
// APIVoid risky verdict is a hard blocklist hit). The Stage-0 commerce-flag
// count is a corroborating signal capped low so a chip-heavy but
// old/registered/clean shop doesn't tip to high-concern on chips alone.
//
// Pure — no I/O. Unit-tested in __tests__/shop-check-score.test.ts.

import type {
  AbnStatus,
  DomainAgeBand,
  ShopCheckBand,
  Verdict,
} from "@askarthur/types";

const DOMAIN_AGE_POINTS: Record<DomainAgeBand, number> = {
  fresh: 35, // < 30 days
  recent: 18, // 30–90 days
  established: 0, // ≥ 90 days
  // WHOIS unavailable. An unverifiable registration date is a mild
  // corroborating concern — not a free pass for a fake shop hiding behind a
  // WHOIS-restricted TLD (e.g. .au) or a privacy proxy. Capped at 6 so
  // `unknown` + `no-abn` (18) = 24 stays inside the low-concern band (< 25):
  // an unverifiable domain never tips an otherwise-clean shop on its own.
  unknown: 6,
};

const ABN_POINTS: Record<AbnStatus, number> = {
  unregistered: 30, // ABN shown but not on the ABR register
  "no-abn": 18, // .au shop, no ABN displayed at all
  "name-mismatch": 12, // registered, but the holder name doesn't match
  verified: 0,
  "not-applicable": 0, // non-AU host — absence of an ABN is expected
};

const APIVOID_POINTS: Record<"safe" | "suspicious" | "risky", number> = {
  risky: 35,
  suspicious: 18,
  safe: 0,
};

const FLAG_POINTS = 6;
const FLAG_CAP = 3; // at most +18 from Stage-0 commerce flags

export interface CompositeScoreInput {
  domainAgeBand: DomainAgeBand;
  abnStatus: AbnStatus;
  /** APIVoid verdict, or null when the paid feed was skipped/unavailable. */
  apivoidVerdict: "safe" | "suspicious" | "risky" | null;
  /** Count of Stage-0 commerce flags carried from the analyze result. */
  commerceFlagCount: number;
}

export interface CompositeScore {
  score: number; // 0-100
  band: ShopCheckBand;
}

/** Map a 0-100 composite score to a concern band. Never "safe". */
export function scoreToBand(score: number): ShopCheckBand {
  if (score < 25) return "low-concern";
  if (score < 60) return "some-concern";
  return "high-concern";
}

/**
 * Map a concern band to the internal `shop_checks.verdict` column value.
 * This is NOT shown as the analyze verdict — the deep check is a separate
 * display. It only exists so the typed column carries a usable value for
 * the gated B2B surface (#322).
 */
export function bandToVerdict(band: ShopCheckBand): Verdict {
  switch (band) {
    case "low-concern":
      return "SAFE";
    case "some-concern":
      return "SUSPICIOUS";
    case "high-concern":
      return "HIGH_RISK";
  }
}

/** Compute the composite risk score + band from the enrichment signals. */
export function computeCompositeScore(
  input: CompositeScoreInput,
): CompositeScore {
  let raw = 0;
  raw += DOMAIN_AGE_POINTS[input.domainAgeBand];
  raw += ABN_POINTS[input.abnStatus];
  raw += input.apivoidVerdict ? APIVOID_POINTS[input.apivoidVerdict] : 0;
  raw +=
    Math.min(Math.max(input.commerceFlagCount, 0), FLAG_CAP) * FLAG_POINTS;

  const score = Math.min(100, Math.max(0, Math.round(raw)));
  return { score, band: scoreToBand(score) };
}
