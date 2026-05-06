// Types for the News Intel narrative pipeline (regulator-published alerts
// from Scamwatch / ACSC / ASIC). Distinct from intelligence.ts which covers
// scam_reports / entities / clusters — those are user-generated, this is
// regulator-authored.

export type RegulatorSource = "scamwatch_alert" | "acsc" | "asic_investor";

export type RegulatorSourceLabel = "ACCC Scamwatch" | "ASD ACSC" | "ASIC";

/**
 * A regulator-published alert as surfaced by the public mobile + B2B APIs.
 * Backed by feed_items rows where source IN ('scamwatch_alert', 'acsc',
 * 'asic_investor').
 */
export interface RegulatorAlert {
  id: number;
  source: RegulatorSource;
  /** Friendly source label for UI render (e.g. "ACCC Scamwatch"). */
  sourceLabel: RegulatorSourceLabel | string;
  title: string;
  /** Short summary — capped at 280 chars. May be null if the upstream feed
   *  didn't supply a meta description and the body is too long to use as-is. */
  summary: string | null;
  /** Original article URL (links back to the regulator's site). */
  url: string | null;
  /** Optional category (phishing / investment_fraud / impersonation / …). */
  category: string | null;
  /** Optional brand the alert flags as being impersonated. */
  impersonatedBrand: string | null;
  /** ISO timestamp of upstream publication (NOT our ingestion time). */
  publishedAt: string | null;
}
