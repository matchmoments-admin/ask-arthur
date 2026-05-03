// Adapter from CharityCheckResult → ResultCard props.
//
// The homepage "Charity Upload Image" flow (drawer → ScamChecker) routes
// directly to /api/charity-check and renders the verdict via the standard
// ResultCard so users see the same thumbs/check-another/report affordances
// as a normal scam check. The standalone /charity-check page keeps using
// the richer CharityVerdict component — this adapter is only for the
// homepage path.
//
// Verdict mapping: ResultCard speaks the 3-level scale (SAFE | SUSPICIOUS |
// HIGH_RISK) while CharityCheckResult speaks the canonical 4-level scale
// (adds UNCERTAIN). UNCERTAIN folds to SUSPICIOUS — same amber treatment,
// "this looks suspicious" is the closest copy match for "we couldn't fully
// verify."

import type { CharityCheckResult } from "@/components/CharityVerdict";

type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

interface ResultCardCharityProps {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
}

function mapVerdict(v: CharityCheckResult["verdict"]): Verdict {
  switch (v) {
    case "SAFE":
      return "SAFE";
    case "HIGH_RISK":
      return "HIGH_RISK";
    case "SUSPICIOUS":
    case "UNCERTAIN":
    default:
      return "SUSPICIOUS";
  }
}

function buildRedFlags(result: CharityCheckResult): string[] {
  const flags: string[] = [];
  // Lead with the engine's plain-English explanation — it already encodes
  // the headline reason for the verdict.
  if (result.explanation) flags.push(result.explanation);

  const acncDetail = (result.pillars.acnc_registration?.detail ?? {}) as Record<string, unknown>;
  const abrDetail = (result.pillars.abr_dgr?.detail ?? {}) as Record<string, unknown>;
  const donationDetail = (result.pillars.donation_url?.detail ?? {}) as Record<string, unknown>;

  // ACNC pillar — only surface when the pillar ran.
  if (result.pillars.acnc_registration.available) {
    const registered = acncDetail.registered === true;
    const legalName = acncDetail.charity_legal_name as string | undefined;
    if (registered && legalName) {
      flags.push(`Registered with the ACNC. ${legalName} appears on the Charities Register.`);
    } else if (registered) {
      flags.push("Registered with the ACNC.");
    } else {
      flags.push("Not on the ACNC Charities Register. Many legitimate small fundraisers are unregistered, but be cautious about tax-deductibility claims.");
    }
  }

  // ABR pillar — ABN active + DGR endorsement.
  if (result.pillars.abr_dgr.available) {
    const abnStatus = (abrDetail.abn_status as string | undefined) ?? "";
    const abnActive = abnStatus.length > 0 && !abnStatus.toLowerCase().startsWith("can");
    const abn = (acncDetail.abn as string | undefined) ?? (abrDetail.abn as string | undefined);
    if (abnActive && abn) {
      flags.push(`ABN is active. ${abn} is registered with the Australian Business Register.`);
    } else if (!abnActive && abnStatus) {
      flags.push(`ABN is ${abnStatus.toLowerCase()}. Treat with caution.`);
    }
    if (abrDetail.dgr_endorsed === true) {
      flags.push("DGR endorsed. Donations are tax-deductible.");
    }
  }

  // Donation URL pillar — only when a URL was supplied and something
  // notable was found.
  if (result.pillars.donation_url.available) {
    const safeBrowsingMalicious = donationDetail.safe_browsing_malicious === true;
    const ageBand = donationDetail.domain_age_band as string | undefined;
    const domain = donationDetail.domain as string | undefined;
    if (safeBrowsingMalicious && domain) {
      flags.push(`Donation URL flagged by Safe Browsing. ${domain} is on a known-malicious list.`);
    } else if (ageBand && ageBand !== "established_90d_plus" && domain) {
      flags.push(`Donation domain is recently registered. ${domain} is less than 90 days old — a common pattern for scam fundraising sites.`);
    }
  }

  // Scamwatch alerts — context, not a pillar.
  if (result.scamwatch_alerts && result.scamwatch_alerts.count > 0) {
    flags.push(`${result.scamwatch_alerts.count} recent Scamwatch alert${result.scamwatch_alerts.count === 1 ? "" : "s"} mention this name. Often it's the impersonator being reported, not the legitimate charity — verify the ABN before donating.`);
  }

  return flags;
}

function buildNextSteps(result: CharityCheckResult): string[] {
  const steps: string[] = [];
  if (result.official_donation_url) {
    steps.push(`Donate via the official site: ${result.official_donation_url}`);
  }
  if (result.verdict !== "SAFE") {
    steps.push("Verify directly with the charity using contact details from the ACNC register, not from the lanyard or flyer.");
  }
  return steps;
}

export function charityResultToResultCardProps(
  result: CharityCheckResult,
): ResultCardCharityProps {
  return {
    verdict: mapVerdict(result.verdict),
    // composite_score is 0..100 risk → invert for confidence.
    confidence: Math.max(0, Math.min(100, 100 - result.composite_score)),
    summary: result.explanation,
    redFlags: buildRedFlags(result),
    nextSteps: buildNextSteps(result),
  };
}
