// Shared contract for Phone Footprint providers + a withTimeout helper
// modelled on entity-enrichment.ts.

import type { PillarResult, FootprintRequestContext } from "./types";

export interface ProviderContract {
  /** Short stable ID, used in providers_used + logs. */
  id: string;
  /** Per-provider timeout inside the orchestrator's 6s batch budget. */
  timeoutMs: number;
  /** Run the provider. May return one or more pillars (Vonage emits two). */
  run(
    msisdn: string,
    ctx: FootprintRequestContext,
  ): Promise<PillarResult | PillarResult[]>;
}

/**
 * Wrap a promise in a timeout. On timeout, the returned promise rejects
 * with a tagged error so the orchestrator can attribute `pillar_status =
 * degraded` to the right provider.
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
 * Canonical "provider unavailable" pillar shape. Centralised so scorer logic
 * (weight redistribution) stays stable.
 */
export function unavailablePillar(
  id: PillarResult["id"],
  reason: string,
): PillarResult {
  return { id, score: 0, confidence: 0, available: false, reason };
}
