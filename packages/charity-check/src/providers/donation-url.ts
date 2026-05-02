// Donation-URL pillar — Google Safe Browsing + WHOIS domain-age scrutiny
// for the URL the user (or fundraiser) gave as the donation destination.
//
// Two checks run in parallel inside this single pillar:
//   1. Safe Browsing — Google's blocklist + (when key present) VirusTotal.
//      Wraps `checkURLReputation()` from @askarthur/scam-engine/safebrowsing.
//      `isMalicious=true` → score 100, hard ceiling.
//   2. WHOIS domain age — wraps `lookupWhois()` from
//      @askarthur/scam-engine/whois. A donation domain registered in the
//      last 30 days during a disaster appeal is the canonical fake-charity
//      scam pattern. Bands: <30d → 80, 30-90d → 50, 90+ → 0.
//
// Scoring takes the MAX across the two sub-checks (not weighted blend),
// because either signal alone is enough to flag a URL as risky and we
// don't want a clean WHOIS to dilute a Safe-Browsing hit.
//
// SSRF guarded at the top — `isPrivateURL()` from safebrowsing.ts blocks
// localhost / RFC 1918 / metadata IPs before any network call.

import { logger } from "@askarthur/utils/logger";
import {
  checkURLReputation,
  isPrivateURL,
} from "@askarthur/scam-engine/safebrowsing";
import { lookupWhois, type WhoisResult } from "@askarthur/scam-engine/whois";

import { unavailablePillar, type CharityProviderContract } from "../provider-contract";
import type { CharityCheckInput, CharityPillarResult } from "../types";

const PROVIDER_ID = "donation_url";

const FRESH_DOMAIN_DAYS = 30;
const SUSPICIOUS_DOMAIN_DAYS = 90;

export const donationUrlProvider: CharityProviderContract = {
  id: PROVIDER_ID,
  timeoutMs: 5000,
  async run(input: CharityCheckInput): Promise<CharityPillarResult> {
    if (!input.donationUrl) {
      return unavailablePillar("donation_url", "no_url_provided");
    }

    // SSRF guard: refuse to touch private/internal hosts before issuing any
    // outbound HTTP. The same check the analyze pipeline uses.
    if (isPrivateURL(input.donationUrl)) {
      return {
        id: "donation_url",
        score: 100,
        confidence: 1,
        available: true,
        reason: "private_or_invalid_url",
        detail: { reason: "private_or_invalid_url" },
      };
    }

    let domain: string;
    try {
      domain = new URL(input.donationUrl).hostname.replace(/^www\./i, "");
    } catch {
      return {
        id: "donation_url",
        score: 100,
        confidence: 1,
        available: true,
        reason: "invalid_url",
        detail: { reason: "invalid_url" },
      };
    }

    const [reputationSettled, whoisSettled] = await Promise.allSettled([
      checkURLReputation([input.donationUrl]),
      lookupWhois(domain),
    ]);

    const detail: Record<string, unknown> = { domain };
    let score = 0;
    let confidence = 0.5; // bumped per signal that resolves cleanly

    // Safe-Browsing leg.
    if (reputationSettled.status === "fulfilled") {
      const rep = reputationSettled.value[0];
      if (rep) {
        detail.safe_browsing_checked = true;
        detail.safe_browsing_malicious = rep.isMalicious;
        detail.safe_browsing_sources = rep.sources;
        confidence += 0.25;
        if (rep.isMalicious) score = 100;
      } else {
        detail.safe_browsing_checked = false;
      }
    } else {
      logger.warn("donation-url Safe Browsing leg failed", {
        error: String((reputationSettled.reason as Error)?.message ?? reputationSettled.reason),
      });
      detail.safe_browsing_error = String(
        (reputationSettled.reason as Error)?.message ?? reputationSettled.reason,
      );
    }

    // WHOIS / domain-age leg.
    if (whoisSettled.status === "fulfilled") {
      const w: WhoisResult = whoisSettled.value;
      detail.whois_registrar = w.registrar;
      detail.whois_country = w.registrantCountry;
      detail.whois_created_date = w.createdDate;
      detail.whois_private = w.isPrivate;

      if (w.createdDate) {
        confidence += 0.25;
        const ageDays = domainAgeDays(w.createdDate);
        detail.domain_age_days = ageDays;
        if (ageDays !== null) {
          // MAX across signals, not blend — see header comment.
          if (ageDays < FRESH_DOMAIN_DAYS) {
            score = Math.max(score, 80);
            detail.domain_age_band = "fresh_under_30d";
          } else if (ageDays < SUSPICIOUS_DOMAIN_DAYS) {
            score = Math.max(score, 50);
            detail.domain_age_band = "fresh_30_to_90d";
          } else {
            detail.domain_age_band = "established_90d_plus";
          }
        }
      } else {
        detail.domain_age_band = "unknown";
      }
    } else {
      logger.warn("donation-url WHOIS leg failed", {
        error: String((whoisSettled.reason as Error)?.message ?? whoisSettled.reason),
      });
      detail.whois_error = String(
        (whoisSettled.reason as Error)?.message ?? whoisSettled.reason,
      );
    }

    // If both legs failed, treat the pillar as unavailable so the scorer
    // redistributes its weight. A pillar that returns score=0 with no
    // signal is misleading.
    if (
      detail.safe_browsing_checked !== true &&
      detail.whois_created_date == null &&
      detail.safe_browsing_error &&
      detail.whois_error
    ) {
      return unavailablePillar("donation_url", "all_legs_failed");
    }

    return {
      id: "donation_url",
      score,
      confidence: Math.min(1, confidence),
      available: true,
      detail,
    };
  },
};

/** Days between an ISO date and today, or null on parse failure. */
export function domainAgeDays(isoDate: string): number | null {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
