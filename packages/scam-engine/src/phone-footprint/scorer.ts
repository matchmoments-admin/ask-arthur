// Composite score, band thresholds, and redactForFree logic.
//
// Weights are the v1 plan values (see docs/plans/phone-footprint-v2.md §2).
// When a pillar reports `available: false`, its weight is redistributed
// pro-rata across available pillars so the total weight is always 1.0.
// This is the "graceful degradation" rule that lets the footprint render
// meaningfully even when Vonage coverage is pending per carrier.

import type {
  Footprint,
  FootprintTier,
  PillarId,
  PillarResult,
  Coverage,
} from "./types";

/** v1 pillar weights. Sum = 1.0. */
export const PILLAR_WEIGHTS: Record<PillarId, number> = {
  scam_reports: 0.3,
  breach: 0.2,
  reputation: 0.25,
  sim_swap: 0.15,
  identity: 0.1,
};

/** Scoring-algorithm version. Stamped onto every snapshot so future
 *  re-scoring waves can detect stale composites and re-compute. */
export const SCORING_VERSION = 1 as const;

export function bandFromScore(score: number): Footprint["band"] {
  if (score < 25) return "safe";
  if (score < 50) return "caution";
  if (score < 75) return "high";
  return "critical";
}

/**
 * Compose a composite score from the pillar results, applying graceful
 * degradation when any pillar is unavailable. Returns just the score + band;
 * the orchestrator assembles the full Footprint.
 */
export function computeCompositeScore(
  pillars: Record<PillarId, PillarResult>,
): { score: number; band: Footprint["band"] } {
  // Sum weights of available pillars. If all pillars are unavailable (a hard
  // failure scenario — e.g., every upstream down), return 0/safe so the UI
  // can fall back to a "can't evaluate" state without crashing. Downstream
  // callers should check coverage + providers_used to decide whether to
  // retry or show an error.
  let availableWeight = 0;
  for (const id of Object.keys(PILLAR_WEIGHTS) as PillarId[]) {
    if (pillars[id]?.available) availableWeight += PILLAR_WEIGHTS[id];
  }
  if (availableWeight === 0) {
    return { score: 0, band: "safe" };
  }

  let weightedSum = 0;
  for (const id of Object.keys(PILLAR_WEIGHTS) as PillarId[]) {
    const p = pillars[id];
    if (!p || !p.available) continue;
    // Each pillar contributes (its score) × (its weight / sum of available
    // weights). Confidence is held separately on the pillar itself for UI
    // display; we do NOT discount the score by confidence here because
    // users deserve the provider's best estimate, not a blended halfway.
    weightedSum += p.score * (PILLAR_WEIGHTS[id] / availableWeight);
  }

  const score = Math.max(0, Math.min(100, Math.round(weightedSum)));
  return { score, band: bandFromScore(score) };
}

/**
 * Redact pillar detail for tiers that don't get it:
 *   - `tier === 'teaser'` always redacts pillar detail (free tier default).
 *   - `!ownershipProven` redacts regardless of tier — the APP 3.5 "fair
 *     means" defence against third-party enumeration.
 *
 * What survives redaction: pillar id, availability flag, and a boolean
 * `triggered` indicating the pillar contributed >0 to the composite. No
 * provider-specific detail (no breach names, no scam_reports IDs, no
 * carrier strings). This is the line that keeps the free tier legally
 * defensible and the paid tier valuable.
 */
export function redactForFree(
  pillars: Record<PillarId, PillarResult>,
): Record<PillarId, PillarResult> {
  const out = {} as Record<PillarId, PillarResult>;
  for (const id of Object.keys(pillars) as PillarId[]) {
    const p = pillars[id];
    out[id] = {
      id,
      score: p.available && p.score > 0 ? 1 : 0, // 0/1 — triggered or not
      confidence: 0, // hidden
      available: p.available,
      reason: p.reason,
    };
  }
  return out;
}

/**
 * Decide whether a lookup must be downgraded to teaser output regardless of
 * the caller's tier. Two rules:
 *   1. The `crossIpDowngrade` flag from the rate-limit check (stalker/
 *      enumeration detection) forces teaser-only for 24h.
 *   2. Paid tiers without `ownershipProven` degrade to teaser — this is the
 *      self-lookup constraint.
 */
export function effectiveTier(args: {
  requestedTier: FootprintTier;
  ownershipProven: boolean;
  crossIpDowngrade: boolean;
}): FootprintTier {
  if (args.crossIpDowngrade) return "teaser";
  if (!args.ownershipProven) return "teaser";
  return args.requestedTier;
}

/**
 * Default coverage structure — represents "everything unknown" before the
 * orchestrator starts filling in per-provider status. Providers mutate
 * their own slot on completion; anything still at its default after fan-out
 * is reported as `degraded` so the UI surfaces partial coverage honestly.
 */
export function initialCoverage(): Coverage {
  return {
    vonage: "disabled",
    leakcheck: "disabled",
    ipqs: "disabled",
    twilio: "degraded",
    internal: "degraded",
  };
}
