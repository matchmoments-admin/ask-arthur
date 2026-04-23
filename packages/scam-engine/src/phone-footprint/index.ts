// Public barrel for the Phone Footprint module.
//
// API routes / Inngest functions import everything through this file so the
// internal module layout can change without rippling changes into apps/web.

export type {
  Footprint,
  FootprintRequestContext,
  FootprintTier,
  FootprintDelta,
  AlertType,
  PillarId,
  PillarResult,
  Coverage,
} from "./types";

export {
  buildPhoneFootprint,
  persistFootprint,
  BATCH_TIMEOUT_MS,
} from "./orchestrator";

export {
  computeCompositeScore,
  bandFromScore,
  redactForFree,
  effectiveTier,
  initialCoverage,
  PILLAR_WEIGHTS,
  SCORING_VERSION,
} from "./scorer";

export { computeDelta } from "./delta";

export { explainFootprint } from "./explain";

export {
  hashMsisdn,
  hashIdentifierForPf,
  normalizePhoneE164,
} from "./normalize";
