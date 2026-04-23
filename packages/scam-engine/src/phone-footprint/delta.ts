// Compare two footprint snapshots and emit alerts for the monthly refresh
// job. Severity laddering is deliberately conservative — we'd rather miss
// a low-signal "score wiggled by 6 points" event than spam users with
// noise. Each caller-configured monitor has an `alert_threshold` score
// delta that gates the band-change / score-delta emit; defaults to 15.

import type { Footprint, FootprintDelta } from "./types";

/**
 * Diff two footprints and return the alert deltas that cross the monitor's
 * threshold. Returns [] when nothing notable changed.
 */
export function computeDelta(
  prev: Footprint,
  next: Footprint,
  opts: { scoreThreshold: number } = { scoreThreshold: 15 },
): FootprintDelta[] {
  const deltas: FootprintDelta[] = [];

  // Band change is the #1 alert — it's the bit users remember.
  if (prev.band !== next.band) {
    const worsened = BAND_ORDER[next.band] > BAND_ORDER[prev.band];
    deltas.push({
      type: "band_change",
      severity: worsened ? "critical" : "info",
      detail: {
        prev: prev.band,
        next: next.band,
        score_delta: next.composite_score - prev.composite_score,
      },
    });
  }

  // Score delta — only emit if >= threshold AND band unchanged (otherwise
  // band_change already captured it).
  if (prev.band === next.band) {
    const diff = Math.abs(next.composite_score - prev.composite_score);
    if (diff >= opts.scoreThreshold) {
      deltas.push({
        type: "score_delta",
        severity: diff >= 30 ? "warning" : "info",
        detail: {
          prev_score: prev.composite_score,
          next_score: next.composite_score,
          delta: next.composite_score - prev.composite_score,
        },
      });
    }
  }

  // New breach(es) on the breach pillar.
  const prevBreaches = (pillarField(prev, "breach", "breaches") as string[] | undefined) ?? [];
  const nextBreaches = (pillarField(next, "breach", "breaches") as string[] | undefined) ?? [];
  const newBreaches = diffArrays(prevBreaches, nextBreaches);
  if (newBreaches.length) {
    deltas.push({
      type: "new_breach",
      severity: "critical",
      detail: { new: newBreaches, total: nextBreaches.length },
    });
  }

  // New scam_reports on the internal pillar — watch the entity_report_count.
  const prevReports = (pillarField(prev, "scam_reports", "entity_report_count") as number) ?? 0;
  const nextReports = (pillarField(next, "scam_reports", "entity_report_count") as number) ?? 0;
  if (nextReports > prevReports) {
    deltas.push({
      type: "new_scam_reports",
      severity: nextReports - prevReports >= 3 ? "warning" : "info",
      detail: { prev: prevReports, next: nextReports, new: nextReports - prevReports },
    });
  }

  // Fresh SIM swap on the sim_swap pillar. This is the flagship premium
  // alert when Vonage is live.
  const prevSwap = pillarField(prev, "sim_swap", "most_recent_swap_at") as string | undefined;
  const nextSwap = pillarField(next, "sim_swap", "most_recent_swap_at") as string | undefined;
  if (nextSwap && nextSwap !== prevSwap) {
    deltas.push({
      type: "sim_swap",
      severity: "critical",
      detail: { swapped_at: nextSwap, prev_swap_at: prevSwap ?? null },
    });
  }

  // Carrier change detected by Twilio Lookup / identity pillar.
  const prevCarrier = pillarField(prev, "identity", "carrier") as string | undefined;
  const nextCarrier = pillarField(next, "identity", "carrier") as string | undefined;
  if (prevCarrier && nextCarrier && prevCarrier !== nextCarrier) {
    deltas.push({
      type: "carrier_change",
      severity: "warning",
      detail: { prev: prevCarrier, next: nextCarrier },
    });
  }

  // Fraud-score jump on the reputation pillar — 25-point swing on Vonage's
  // own fraud_score is worth a heads-up even without a band change.
  const prevFraud = (pillarField(prev, "reputation", "fraud_score") as number) ?? null;
  const nextFraud = (pillarField(next, "reputation", "fraud_score") as number) ?? null;
  if (prevFraud !== null && nextFraud !== null && Math.abs(nextFraud - prevFraud) >= 25) {
    deltas.push({
      type: "fraud_score_delta",
      severity: "warning",
      detail: { prev: prevFraud, next: nextFraud, delta: nextFraud - prevFraud },
    });
  }

  return deltas;
}

const BAND_ORDER = { safe: 0, caution: 1, high: 2, critical: 3 } as const;

function pillarField(
  fp: Footprint,
  pillar: keyof Footprint["pillars"],
  field: string,
): unknown {
  return fp.pillars[pillar]?.detail?.[field];
}

function diffArrays(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev);
  return next.filter((x) => !prevSet.has(x));
}
