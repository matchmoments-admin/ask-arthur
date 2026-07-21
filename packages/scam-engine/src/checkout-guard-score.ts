import type { SignalType } from "@askarthur/shopfront-glue";
import type { DomainAgeBand, Verdict } from "@askarthur/types";

// Checkout Guardrail scorer (PR-B1). A pure, synchronous, additive model over
// the cheap signals available BEFORE a user submits card details on a checkout
// page — the intervention point victims miss on lookalike storefronts reached
// via Google Shopping ads. Mirrors the transparent additive style of
// shop-check-score.ts but with the checkout-relevant signal set (a lexical
// lookalike of a watchlist brand is the dominant signal; the paid APIVoid /
// ABN enrichment stays in the opt-in Deep Shop Check, off the hot path).
//
// Band thresholds match shop-check-score's scoreToBand (<25 / <60 / ≥60).

export interface CheckoutGuardSignals {
  /** Domain is a lexical lookalike of a watchlist brand (and NOT one of that
   *  brand's official domains — lexicalMatch already excludes self-clones). */
  lexical: { brand: string; signalType: SignalType } | null;
  /** The checkout domain is a known entry in scam_urls. */
  scamUrl: { threatLevel: "LOW" | "MEDIUM" | "HIGH" } | null;
  /** Registration-age band of the checkout domain, or null when age was not
   *  assessed (the route skips live WHOIS on clean / .au domains — see route). */
  domainAgeBand: DomainAgeBand | null;
  /** The page visually displays a watchlist brand whose official domains do
   *  NOT include this domain (brand-asset-vs-domain mismatch). */
  brandOnPageMismatch: boolean;
}

export interface CheckoutGuardScore {
  /** 0–100 composite. */
  score: number;
  verdict: Verdict;
  /** Plain-language reasons for the warning overlay. */
  reasons: string[];
}

const LEXICAL_POINTS: Record<SignalType, number> = {
  confusable: 45, // homoglyph / IDN — almost always deliberate
  substring: 35, // brand embedded in a longer host
  levenshtein: 40, // one-edit typosquat
};

// A known-active scam domain alone is enough to clear the HIGH_RISK bar (60).
const SCAM_URL_POINTS: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
  LOW: 15,
  MEDIUM: 35,
  HIGH: 60,
};

// Fresh registration is a strong composite signal. `unknown` is never treated
// as safe (auDA withholds .au registration dates from every free source — see
// whois-cached.ts) but is not over-penalised on its own.
const DOMAIN_AGE_POINTS: Record<DomainAgeBand, number> = {
  fresh: 25,
  recent: 12,
  established: 0,
  unknown: 6,
};

const BRAND_MISMATCH_POINTS = 20;

const HIGH_RISK_THRESHOLD = 60;
const SUSPICIOUS_THRESHOLD = 25;

export function scoreCheckoutGuard(
  signals: CheckoutGuardSignals,
): CheckoutGuardScore {
  let raw = 0;
  const reasons: string[] = [];

  if (signals.lexical) {
    // `?? 0` guards against an unexpected signal_type poisoning `raw` with NaN,
    // which would silently collapse every verdict to SAFE.
    raw += LEXICAL_POINTS[signals.lexical.signalType] ?? 0;
    reasons.push(
      `This web address closely resembles ${signals.lexical.brand} but is not an official ${signals.lexical.brand} domain.`,
    );
  }

  if (signals.scamUrl) {
    raw += SCAM_URL_POINTS[signals.scamUrl.threatLevel] ?? 0;
    reasons.push(
      `This domain is on Ask Arthur's threat list (${signals.scamUrl.threatLevel.toLowerCase()} confidence).`,
    );
  }

  if (signals.domainAgeBand) {
    raw += DOMAIN_AGE_POINTS[signals.domainAgeBand] ?? 0;
    if (signals.domainAgeBand === "fresh") {
      reasons.push(
        "The domain was registered very recently (under 30 days ago).",
      );
    } else if (signals.domainAgeBand === "recent") {
      reasons.push("The domain was registered recently (under 90 days ago).");
    }
  }

  if (signals.brandOnPageMismatch) {
    raw += BRAND_MISMATCH_POINTS;
    reasons.push(
      "The page displays a well-known brand, but the web address is not that brand's official domain.",
    );
  }

  const score = Math.min(100, Math.max(0, Math.round(raw)));
  const verdict: Verdict =
    score >= HIGH_RISK_THRESHOLD
      ? "HIGH_RISK"
      : score >= SUSPICIOUS_THRESHOLD
        ? "SUSPICIOUS"
        : "SAFE";

  return { score, verdict, reasons };
}
