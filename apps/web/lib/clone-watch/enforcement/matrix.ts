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

import { abuseChannels, readAttribution } from "@/lib/clone-watch/attribution";

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
  /** shopfront_clone_alerts.attribution jsonb, read through the ONE reader
   *  (lib/clone-watch/attribution.ts) — never destructured here. */
  attribution?: unknown;
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

  // Registrar / host levers come from the attribution dossier. Both stay
  // human_required (itch.io invariant); an abuse report with no evidenced
  // recipient is noise, so a channel is added only when attribution gives one.
  for (const ch of abuseChannels(readAttribution(alert.attribution))) {
    if (ch.kind === "registrar") {
      plans.push({
        channel: "registrar_abuse",
        autonomy: "human_required",
        actsOnParked: false, // registrars increasingly decline parked-only lookalikes
        deepLink: ch.email ? undefined : (ch.url ?? undefined),
        note: ch.email
          ? `Registrar abuse → ${ch.email} (${ch.label}). Frame as evidenced phishing/DNS-abuse, NOT trademark.`
          : `Registrar abuse form (${ch.label}) — no abuse email on record. Frame as evidenced phishing/DNS-abuse, NOT trademark.`,
      });
    } else {
      plans.push({
        channel: "hosting_abuse",
        autonomy: "human_required",
        actsOnParked: false,
        deepLink: ch.url ?? undefined,
        note: `Hosting abuse form (${ch.label}) — report the exact phishing URL.`,
      });
    }
  }

  return plans;
}
