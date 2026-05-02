// @askarthur/charity-check — public surface.
//
// One entry point: runCharityCheck(input). The route handler owns
// persistence + cost telemetry + rate-limiting; the engine owns
// fan-out + scoring + verdict mapping. See ADR-0002.

export { runCharityCheck, BATCH_TIMEOUT_MS } from "./orchestrator";
export {
  PILLAR_WEIGHTS,
  SCORING_VERSION,
  applyVerdictFloors,
  computeCompositeScore,
  explainResult,
  verdictFromScore,
} from "./scorer";
export { unavailablePillar, withTimeout } from "./provider-contract";
export type {
  CharityCheckInput,
  CharityCheckResult,
  CharityCoverage,
  CharityPillarId,
  CharityPillarResult,
  ScamwatchAlertContext,
} from "./types";
export type { CharityProviderContract } from "./provider-contract";
export { ocrLanyard, type LanyardExtraction } from "./ocr-lanyard";
