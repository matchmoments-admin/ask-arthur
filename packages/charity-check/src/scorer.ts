// Composite scoring + verdict mapping for Charity Check.
//
// Weights mirror the Phone Footprint pattern (sum to 1.0, redistributed
// pro-rata when a pillar is unavailable). The verdict is the canonical
// 4-level Verdict enum from @askarthur/types — pillar-specific concerns
// stay inside the pillars[] sub-object on the result.
//
// Hard-floor rules (verdict overrides regardless of composite score):
//   - paymentMethod ∈ {cash, gift_card, crypto, bank_transfer} → HIGH_RISK
//     (Scamwatch-validated heuristic; the F2F-fundraiser asking for cash
//     is the highest-fidelity scam signal we have).
//   - ACNC pillar's detail.typosquat_match === true → HIGH_RISK
//     (input name had no exact ACNC match but had a >0.85 trigram
//     similarity to a registered charity — classic impersonation).

import type { Verdict } from "@askarthur/types";
import type {
  CharityCheckInput,
  CharityCheckResult,
  CharityPillarId,
  CharityPillarResult,
} from "./types";

/** Pillar weights as of v0.2c. Sum = 1.0.
 *
 * PFRA gets a small weight (0.1) and contributes ADDITIVELY ONLY (the
 * PFRA pillar reports score=0 when the charity IS a member, and
 * `available: false` when it isn't). So in practice PFRA either nudges
 * the score down (towards SAFE) or doesn't fire at all — never up. */
export const PILLAR_WEIGHTS: Record<CharityPillarId, number> = {
  acnc_registration: 0.45,
  abr_dgr: 0.25,
  donation_url: 0.2,
  pfra: 0.1,
};

/** Bumped when the scoring algorithm or thresholds change so future
 *  re-scoring waves can detect stale composites. */
export const SCORING_VERSION = 1 as const;

/** Score → verdict band. Aligned with Phone Footprint's quartiles for
 *  cross-feature operator legibility. */
export function verdictFromScore(score: number): Verdict {
  if (score < 25) return "SAFE";
  if (score < 50) return "UNCERTAIN";
  if (score < 75) return "SUSPICIOUS";
  return "HIGH_RISK";
}

/**
 * Compose a 0..100 risk score from available pillars. Unavailable pillars
 * are excluded and their weight is redistributed pro-rata across what's
 * left, so the result is meaningful even when only one pillar reports.
 *
 * If every pillar is unavailable (a hard upstream-down scenario) the
 * function returns score=50/UNCERTAIN — explicitly NOT 0/SAFE — so the
 * UI doesn't accidentally green-light an unverified charity when both
 * registers are unreachable.
 */
export function computeCompositeScore(
  pillars: Record<CharityPillarId, CharityPillarResult>,
): { score: number; verdict: Verdict } {
  let availableWeight = 0;
  for (const id of Object.keys(PILLAR_WEIGHTS) as CharityPillarId[]) {
    if (pillars[id]?.available) availableWeight += PILLAR_WEIGHTS[id];
  }
  if (availableWeight === 0) {
    // Fail-safe-ish: when we can't verify anything, refuse to claim safety.
    return { score: 50, verdict: "UNCERTAIN" };
  }

  let weightedSum = 0;
  for (const id of Object.keys(PILLAR_WEIGHTS) as CharityPillarId[]) {
    const p = pillars[id];
    if (!p || !p.available) continue;
    weightedSum += p.score * (PILLAR_WEIGHTS[id] / availableWeight);
  }
  const score = Math.max(0, Math.min(100, Math.round(weightedSum)));
  return { score, verdict: verdictFromScore(score) };
}

/** Apply hard-floor rules that override the composite-score-derived
 *  verdict. Returns the final verdict.
 *
 * The floors only ever escalate, never de-escalate — a SAFE composite
 * with a payment red flag becomes HIGH_RISK, but a HIGH_RISK composite
 * never softens because of a benign payment method. */
export function applyVerdictFloors(
  baseVerdict: Verdict,
  input: CharityCheckInput,
  pillars: Record<CharityPillarId, CharityPillarResult>,
): Verdict {
  const cashLike: NonNullable<CharityCheckInput["paymentMethod"]>[] = [
    "cash",
    "gift_card",
    "crypto",
    "bank_transfer",
  ];
  if (input.paymentMethod && cashLike.includes(input.paymentMethod)) {
    return "HIGH_RISK";
  }

  const typosquat =
    pillars.acnc_registration?.available &&
    pillars.acnc_registration.detail?.typosquat_match === true;
  if (typosquat) return "HIGH_RISK";

  return baseVerdict;
}

/** Build a plain-English summary from the pillar payloads. v0.1 is
 *  template-only — no Claude call — so the engine works offline and at
 *  zero marginal cost. v0.2 may swap to Haiku for nuance. */
export function explainResult(
  result: Pick<CharityCheckResult, "verdict" | "pillars" | "official_donation_url">,
): string {
  const acnc = result.pillars.acnc_registration;
  const abr = result.pillars.abr_dgr;
  const acncDetail = acnc?.detail ?? {};
  const charityName = (acncDetail.charity_legal_name as string | undefined) ?? null;

  switch (result.verdict) {
    case "SAFE": {
      const dgr =
        abr?.detail?.dgr_endorsed === true
          ? " It is endorsed by the ATO as a Deductible Gift Recipient — donations are tax-deductible."
          : "";
      const url = result.official_donation_url
        ? ` If you'd like to donate, the safest way is via their official site (${result.official_donation_url}).`
        : "";
      return `${charityName ?? "This charity"} is registered with the ACNC and the ABN is active.${dgr}${url}`;
    }
    case "UNCERTAIN": {
      return `${charityName ?? "This charity"} appears in the ACNC register but with caveats — the name didn't fully match, an attribute is missing, or one of the cross-checks is unavailable. Pause before donating; ask the fundraiser for their ACNC number and check it on acnc.gov.au/charity.`;
    }
    case "SUSPICIOUS": {
      return `We can't find this charity in the ACNC register, or its ABN is inactive. That doesn't always mean it's a scam — but please don't hand over cash or card details until you can verify it independently at acnc.gov.au/charity.`;
    }
    case "HIGH_RISK": {
      const typosquat = acnc?.detail?.typosquat_match === true;
      const closest = acnc?.detail?.nearest_match as string | undefined;
      if (typosquat && closest) {
        return `Stop. The name you entered closely resembles "${closest}" — a registered charity. This is a common impersonation pattern. Don't donate; report this fundraiser to Scamwatch (scamwatch.gov.au) if approached in person or online.`;
      }
      return `Stop. The signals point to a high risk of scam — unverified charity, cancelled ABN, or a payment method (cash, gift cards, crypto, bank transfer) that legitimate Australian charities don't ask for. Don't donate.`;
    }
  }
}
