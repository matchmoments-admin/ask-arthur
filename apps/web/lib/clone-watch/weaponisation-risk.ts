/**
 * Deterministic weaponisation-risk score (F3) — THE single formula for
 * "which unactioned lookalike is most likely to flip to live phishing".
 *
 * Consumed by (a) the recheck loop (rank the over-fetched worklist, rescan the
 * top 50 first → faster flip detection for the same urlscan budget) and
 * (b) the Brand Stewardship report ("your 5 highest-risk unactioned
 * lookalikes"). ONE formula, ONE module — the v222 recheck RPC returns the
 * score INPUTS only, never a SQL copy of this math (the outcome-copy drift
 * lesson).
 *
 * Zero runtime imports by design (unit-deterministic via injectable nowMs;
 * importable anywhere without dragging the data layer). Structurally mirrors
 * computeCompositeScore (shop-check-score.ts): named additive weights → sum →
 * clamp 0–100 → band. v1 weights are hand-set priors — tune against observed
 * weaponisation outcomes once enough accumulate (score telemetry ships in the
 * recheck fn's log-cost metadata for exactly that).
 *
 * Never throws; every input is null-tolerant (attribution only exists on
 * enriched alerts, the Haiku classification only on classified ones).
 */

export interface WeaponisationRiskInput {
  /** shopfront_clone_alerts.urlscan_classification */
  urlscanClassification: string | null;
  /** shopfront_clone_alerts.signals jsonb ([{signal_type, score, ...}]) */
  signals: unknown;
  /** clone_watch_classifications.is_clone (Haiku) */
  isClone: boolean | null;
  /** clone_watch_classifications.confidence 0..1 */
  confidence: number | null;
  /** clone_watch_classifications.attack_intent */
  attackIntent: string | null;
  /** known_brands.brand_category for the impersonated brand */
  brandCategory: string | null;
  /** attribution.whois.createdDate (ISO) */
  whoisCreatedDate: string | null;
  /** attribution.ip_rep.abuseConfidenceScore 0..100 (AbuseIPDB) */
  ipAbuseConfidenceScore: number | null;
  /** attribution.au_registrant.abnStatus (.au only). Only "cancelled" /
   *  "not-found" score — "lookup-failed"/"no-abn"/null are neutral (ADR-0009:
   *  a failed lookup is NOT evidence the ABN is bad). */
  auAbnStatus?: string | null;
  /** attribution.au_registrant.nameMatchesAbn — false ⇒ registrant name doesn't
   *  match the ABR entity (a spoofed/borrowed ABN). null/true are neutral. */
  auNameMatches?: boolean | null;
  /** Injectable clock for deterministic tests; defaults to Date.now(). */
  nowMs?: number;
}

export interface WeaponisationRisk {
  /** 0–100, deterministic. */
  score: number;
  band: "low" | "elevated" | "critical";
}

/** Primary signal_type of an alert's signals[] (the strongest/first signal).
 *  Canonical home since F3 — auto-triage re-exports for its strict bar. */
export function primarySignalType(signals: unknown): string | null {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  const s = signals[0];
  if (s && typeof s === "object" && "signal_type" in s) {
    const t = (s as { signal_type?: unknown }).signal_type;
    return typeof t === "string" ? t : null;
  }
  return null;
}

// ── Named weights (max raw 110 → clamped 100) ────────────────────────────

/** Empirical prior from the page's current render: already-serving content is
 *  closest to weaponisation; parked → lowest (the reconciler cross-tab:
 *  parked → 0% actioned, and parked clones flip least often per month). */
const URLSCAN_PRIOR_POINTS: Record<string, number> = {
  likely_phishing: 30,
  neutral: 12, // resolves + serves something
  unresolved: 6,
  parked_for_sale: 2,
};
const URLSCAN_PRIOR_DEFAULT = 6; // unscanned/null ≈ unresolved

/** The two intents that monetise fastest after a flip. */
const HIGH_RISK_INTENTS = new Set(["credential_phishing", "payment_fraud"]);
const INTENT_POINTS = 10;

/** Deliberate-deception signals (matches auto-triage's strict bar);
 *  substring is the high-FP class. */
const SIGNAL_POINTS: Record<string, number> = {
  confusable: 12,
  levenshtein: 10,
  substring: 4,
};

/** Credential value of the impersonated brand (known_brands.brand_category).
 *  Values observed in prod: bank/telco/gov/tech/retailer + super/retail/crypto
 *  (v179/v119 seeds) + finance (live data 2026-07-12). */
const BRAND_CATEGORY_POINTS: Record<string, number> = {
  bank: 12,
  finance: 12,
  super: 12,
  crypto: 12,
  gov: 8,
  telco: 8,
  tech: 4,
  retail: 4,
  retailer: 4,
};

/** Fresh NRDs weaponise; WHOIS-hidden age is mildly elevated. Thresholds
 *  mirror whois-cached's domainAgeBand structurally but are owned here —
 *  this module is THE risk formula, not a copy of another feature's band. */
const AGE_POINTS_FRESH = 12; // < 30 days
const AGE_POINTS_RECENT = 8; // < 90 days
const AGE_POINTS_UNKNOWN = 4;
const AGE_POINTS_ESTABLISHED = 0;

/** AbuseIPDB-confirmed bad hosting neighbourhood. */
const IP_REP_HIGH_POINTS = 14; // abuseConfidenceScore ≥ 75
const IP_REP_MID_POINTS = 7; // ≥ 25

/** .au registrant ABN verdict. A cancelled/unregistered ABN on a .au lookalike
 *  is a strong deception signal; a name mismatch (borrowed ABN) is milder.
 *  Only these two states score — lookup-failed / no-abn / absent → 0, so
 *  flag-OFF and non-.au domains are score-identical (the score stays clamped
 *  at 100, so the effective ceiling is unchanged). */
const AU_ABN_CANCELLED_POINTS = 10;
const AU_ABN_NOT_FOUND_POINTS = 8;
const AU_NAME_MISMATCH_POINTS = 4;

const CLONE_CONFIDENCE_MAX_POINTS = 20;

const BAND_CRITICAL = 70;
const BAND_ELEVATED = 40;

function agePoints(whoisCreatedDate: string | null, nowMs: number): number {
  if (!whoisCreatedDate) return AGE_POINTS_UNKNOWN;
  const created = new Date(whoisCreatedDate).getTime();
  if (Number.isNaN(created)) return AGE_POINTS_UNKNOWN;
  const days = (nowMs - created) / 86_400_000;
  if (days < 30) return AGE_POINTS_FRESH;
  if (days < 90) return AGE_POINTS_RECENT;
  return AGE_POINTS_ESTABLISHED;
}

export function computeWeaponisationRisk(
  i: WeaponisationRiskInput,
): WeaponisationRisk {
  const nowMs = i.nowMs ?? Date.now();
  let raw = 0;

  raw +=
    URLSCAN_PRIOR_POINTS[i.urlscanClassification ?? ""] ?? URLSCAN_PRIOR_DEFAULT;

  if (i.isClone === true && typeof i.confidence === "number") {
    const c = Math.min(1, Math.max(0, i.confidence));
    raw += Math.round(c * CLONE_CONFIDENCE_MAX_POINTS);
  }

  if (i.attackIntent && HIGH_RISK_INTENTS.has(i.attackIntent)) {
    raw += INTENT_POINTS;
  }

  const signal = primarySignalType(i.signals);
  raw += signal ? (SIGNAL_POINTS[signal] ?? 0) : 0;

  raw += i.brandCategory ? (BRAND_CATEGORY_POINTS[i.brandCategory] ?? 0) : 0;

  raw += agePoints(i.whoisCreatedDate, nowMs);

  const rep = i.ipAbuseConfidenceScore;
  if (typeof rep === "number") {
    if (rep >= 75) raw += IP_REP_HIGH_POINTS;
    else if (rep >= 25) raw += IP_REP_MID_POINTS;
  }

  if (i.auAbnStatus === "cancelled") raw += AU_ABN_CANCELLED_POINTS;
  else if (i.auAbnStatus === "not-found") raw += AU_ABN_NOT_FOUND_POINTS;
  if (i.auNameMatches === false) raw += AU_NAME_MISMATCH_POINTS;

  const score = Math.min(100, Math.max(0, Math.round(raw)));
  const band =
    score >= BAND_CRITICAL ? "critical" : score >= BAND_ELEVATED ? "elevated" : "low";
  return { score, band };
}
