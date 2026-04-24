// Carrier-drift detection — pillar 4 fallback when Vonage CAMARA SIM Swap
// isn't available in the user's country (which today means everywhere
// except DE/IT/US/GB/BR/ES/FR/NL/CA).
//
// How it works: every monitor refresh runs Twilio Lookup v2, which
// returns the current carrier name + line type. We compare that to
// the previous snapshot's identity pillar. If the carrier has changed
// (Telstra → Optus, etc.) on a number that hasn't been deliberately
// ported, that's a strong port-out / SIM-swap-via-port indicator.
// If the line type has flipped (mobile → VoIP), that's account-takeover-
// adjacent.
//
// Limitations vs carrier-authoritative SIM swap:
//   - Misses same-carrier SIM swap (where the SIM card changes but the
//     network stays the same — actually the more common attack pattern)
//   - False positives on legitimate ports + MNO-MVNO transitions
//   - Detection rate is roughly 30-40% of real SIM swap events per
//     industry estimates; Vonage CAMARA is ~95%+
//
// Confidence is set to 0.5 (vs Vonage's 0.95) so the scorer treats
// the signal as weaker. The provider is NOT in the orchestrator's
// fan-out list — it runs INSIDE the orchestrator after Twilio + Vonage
// have completed, because it needs both the current Twilio result and
// the previous footprint as inputs (not a fresh external call).

import type {
  Footprint,
  PillarResult,
} from "../types";
import { unavailablePillar } from "../provider-contract";

/**
 * Compare current Twilio identity result against a previous footprint's
 * identity pillar to detect carrier or line-type drift. Returns a
 * sim_swap pillar result.
 *
 * Called from the orchestrator after the main fan-out completes.
 *
 *   - No previous footprint → unavailable (first-time lookup)
 *   - Previous footprint but no identity data → unavailable
 *   - Current identity unavailable → unavailable
 *   - Both available, no change → available with score 0
 *   - Carrier changed → available with score 60-85 depending on signal mix
 */
export function computeCarrierDrift(args: {
  current: PillarResult; // pillar 5 (identity) result from this run
  previous: Footprint | null;
}): PillarResult {
  const { current, previous } = args;

  if (!previous) {
    return unavailablePillar("sim_swap", "carrier_drift_no_baseline");
  }
  if (!current.available || !current.detail) {
    return unavailablePillar("sim_swap", "carrier_drift_current_unavailable");
  }

  const prevIdentity = previous.pillars.identity;
  if (!prevIdentity?.available || !prevIdentity.detail) {
    return unavailablePillar("sim_swap", "carrier_drift_no_prev_identity");
  }

  const prevCarrier = (prevIdentity.detail.carrier as string | null) ?? null;
  const currCarrier = (current.detail.carrier as string | null) ?? null;
  const prevLineType = (prevIdentity.detail.lineType as string | null) ?? null;
  const currLineType = (current.detail.lineType as string | null) ?? null;
  const prevIsVoip = Boolean(prevIdentity.detail.isVoip);
  const currIsVoip = Boolean(current.detail.isVoip);

  // Time delta — drift over a short window is more suspicious than drift
  // over months. Refreshes happen on the monitor's cadence so the previous
  // snapshot's age is approximately one refresh-cadence ago. We don't
  // weight by exact age here; the scorer trusts the per-monitor
  // alert_threshold to filter low-severity events.
  const carrierChanged =
    prevCarrier !== null &&
    currCarrier !== null &&
    prevCarrier.toLowerCase() !== currCarrier.toLowerCase();
  const lineTypeChanged =
    prevLineType !== null &&
    currLineType !== null &&
    prevLineType !== currLineType;
  const flippedToVoip = !prevIsVoip && currIsVoip;

  // Score formula: stack independent signals.
  //   carrier change:       +60  (port-out / SIM-swap-via-port — strong)
  //   line type change:     +25  (mobile → fixed/VoIP is suspicious)
  //   flipped to VoIP:      +15  (extra weight; VoIP forwarding is a
  //                               common ATO terminus)
  // Capped at 100. No change → score 0.
  let score = 0;
  if (carrierChanged) score += 60;
  if (lineTypeChanged) score += 25;
  if (flippedToVoip) score += 15;
  score = Math.min(100, score);

  return {
    id: "sim_swap",
    score,
    confidence: 0.5,
    available: true,
    detail: {
      source: "carrier_drift",
      prev_carrier: prevCarrier,
      current_carrier: currCarrier,
      prev_line_type: prevLineType,
      current_line_type: currLineType,
      carrier_changed: carrierChanged,
      line_type_changed: lineTypeChanged,
      flipped_to_voip: flippedToVoip,
      // most_recent_swap_at uses the previous footprint's generated_at as
      // the "we observed this change at" anchor. Imperfect but close
      // enough for the alert delta surface to fire on it.
      most_recent_swap_at: carrierChanged ? previous.generated_at : undefined,
    },
  };
}
