/**
 * Clone enforcement — the channel matrix (Wave 1).
 *
 * Given a weaponised lookalike, decide WHICH takedown levers apply and, for each,
 * its autonomy (the itch.io false-takedown guard). This is a PURE function so the
 * policy is unit-testable in isolation from Inngest/Supabase.
 *
 * Autonomy:
 *   - 'auto'          reversible ecosystem-blocklist feeds that re-verify before
 *                     acting (APWG, OpenPhish). Only these may ever fire without
 *                     a human — and even then behind FF_CLONE_ENFORCE_AUTO_*.
 *   - 'human_required' domain-level levers + browser-block FORMS (registrar/host
 *                     abuse, Google Safe Browsing, MS SmartScreen). GSB/SmartScreen
 *                     have no submission API — the case carries a prefilled report
 *                     deep-link the operator one-clicks. NEVER auto (itch.io).
 *   - 'brand_routed'  trademark levers (UDRP/auDRP) + the brand's own security
 *                     team — WE never file; we hand the brand an evidence bundle.
 *                     (Added in PR 1.5; not planned here.)
 */

export type EnforcementChannel =
  | "apwg"
  | "openphish"
  | "safe_browsing"
  | "smartscreen"
  | "registrar_abuse"
  | "hosting_abuse";

export type ChannelAutonomy = "auto" | "human_required" | "brand_routed";

export interface ChannelPlan {
  channel: EnforcementChannel;
  autonomy: ChannelAutonomy;
  /** Does this lever act on a merely-parked (not-yet-live) lookalike? Documented
   *  for the case record; the weaponised trigger means content is live anyway. */
  actsOnParked: boolean;
  /** A prefilled report/abuse URL an operator opens (human_required channels). */
  deepLink?: string;
  /** Free-text note surfaced in the case for the operator. */
  note?: string;
}

export interface EnforcementAlert {
  candidateUrl: string;
  candidateDomain: string;
  /**
   * shopfront_clone_alerts.attribution jsonb, as enrichCloneAttribution WRITES
   * it: registrar + abuse contact live under `whois` (camelCase). The flat
   * `registrar_abuse_email` shape this type used to declare was never written
   * by anything — prod 2026-09-22: 0 rows in that shape, 2,455 in `whois` — so
   * the registrar-abuse channel could never be offered. The flat keys stay as
   * a read fallback only.
   */
  attribution?: {
    whois?: {
      registrar?: string | null;
      registrarAbuseEmail?: string | null;
    } | null;
    registrar?: string | null;
    registrar_abuse_email?: string | null;
    /** The enricher writes ip/country/asn only; provider/abuse_email are not
     *  produced by anything today, so hosting abuse is offered only when a
     *  future enrichment adds them. */
    hosting?: {
      ip?: string | null;
      country?: string | null;
      asn?: string | null;
      provider?: string | null;
      abuse_email?: string | null;
    } | null;
  } | null;
}

/**
 * Compute the enforcement plan for a weaponised alert. Always includes the two
 * auto ecosystem feeds (APWG, OpenPhish) + the two browser-block report forms
 * (GSB, SmartScreen). Registrar/host abuse are added only when attribution gives
 * us somewhere to send — an abuse report with no evidenced recipient is noise.
 */
export function selectChannels(alert: EnforcementAlert): ChannelPlan[] {
  const url = alert.candidateUrl;
  const plans: ChannelPlan[] = [
    // Ecosystem blocklist feeds — reversible, re-verified, safe to auto.
    { channel: "apwg", autonomy: "auto", actsOnParked: false },
    { channel: "openphish", autonomy: "auto", actsOnParked: false },
    // Browser-block report FORMS — no API, so a prefilled deep-link the operator
    // submits. URL-scoped (never domain-scoped) per the itch.io lesson.
    {
      channel: "safe_browsing",
      autonomy: "human_required",
      actsOnParked: false,
      deepLink: `https://safebrowsing.google.com/safebrowsing/report_phish/?url=${encodeURIComponent(url)}`,
      note: "Google Safe Browsing — submit the exact phishing URL via the form.",
    },
    {
      channel: "smartscreen",
      autonomy: "human_required",
      actsOnParked: false,
      deepLink:
        "https://www.microsoft.com/en-us/wdsi/support/report-unsafe-site-guest",
      note: "Microsoft SmartScreen — report the exact URL via the form.",
    },
  ];

  const whois = alert.attribution?.whois;
  const registrarEmail =
    whois?.registrarAbuseEmail ?? alert.attribution?.registrar_abuse_email;
  const registrarName =
    whois?.registrar ?? alert.attribution?.registrar ?? "unknown registrar";
  if (registrarEmail) {
    plans.push({
      channel: "registrar_abuse",
      autonomy: "human_required",
      actsOnParked: false, // registrars increasingly decline parked-only lookalikes
      note: `Registrar abuse → ${registrarEmail} (${registrarName}). Frame as evidenced phishing/DNS-abuse, NOT trademark.`,
    });
  }

  const hostEmail = alert.attribution?.hosting?.abuse_email;
  if (hostEmail) {
    plans.push({
      channel: "hosting_abuse",
      autonomy: "human_required",
      actsOnParked: false,
      note: `Hosting abuse → ${hostEmail} (${alert.attribution?.hosting?.provider ?? "unknown host"}).`,
    });
  }

  return plans;
}
