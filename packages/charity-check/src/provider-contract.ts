// Shared contract for Charity Check providers + a withTimeout helper
// modelled on packages/scam-engine/src/phone-footprint/provider-contract.ts.
// Two adapters now implement this contract (acnc + abr) and the orchestrator
// composes them — see ADR-0002 for the "second adapter makes the seam real"
// reasoning.

import type { CharityCheckInput, CharityPillarResult } from "./types";

export interface CharityProviderContract {
  /** Short stable ID, used in providers_used + logs. */
  id: string;
  /** Per-provider timeout inside the orchestrator's overall budget. */
  timeoutMs: number;
  /** Run the provider against the input. May return one or more pillars
   *  (kept open by analogy with Phone Footprint's Vonage-emits-two pattern,
   *  even though no v0.1 charity provider does this). */
  run(input: CharityCheckInput): Promise<CharityPillarResult | CharityPillarResult[]>;
}

/**
 * Wrap a promise in a timeout. On timeout the returned promise rejects with
 * a tagged error so the orchestrator can mark the affected pillar as
 * `available: false` with reason `'timeout'`.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Canonical "provider unavailable" pillar shape. Centralised so the
 * scorer's weight-redistribution logic stays stable when new providers
 * ship in v0.2.
 */
export function unavailablePillar(
  id: CharityPillarResult["id"],
  reason: string,
): CharityPillarResult {
  return { id, score: 0, confidence: 0, available: false, reason };
}
