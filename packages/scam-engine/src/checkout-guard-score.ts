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
  /** The checkout domain has an ACTIVE entry in the scam_urls threat list.
   *  scam_urls.confidence_level is 'low' for ~all 393k rows (the default for
   *  bulk threat-feed ingest), so we score PRESENCE, not the meaningless
   *  confidence tier — the old tiered scoring left a known scam domain at 15pts
   *  → SAFE (the "threat-list arm is inert" review finding). */
  scamUrlListed: boolean;
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

// A scam_urls host match is a real but NOT fully-trustworthy signal: the table
// is bulk threat-feed data and contains legit brands (google.com, github.com,
// dropbox.com …) with bare-host path-phishing entries, so a match alone must not
// assert HIGH_RISK ("reported as a scam") — that would false-accuse a legit
// billing page. Scored as a CORROBORATING signal (clears SUSPICIOUS on its own;
// combined with a lexical lookalike / brand mismatch / fresh domain it reaches
// HIGH_RISK). Fixes the prior bug (confidence was always 'low' → 15 → SAFE) and
// pairs with the route's host-level (not registrable-domain) match.
const SCAM_URL_LISTED_POINTS = 35;

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

  if (signals.scamUrlListed) {
    raw += SCAM_URL_LISTED_POINTS;
    reasons.push(
      "This web address is on Ask Arthur's scam-URL threat list — it has been reported as a scam.",
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
