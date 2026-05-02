/**
 * State-by-state fundraising-licence register links.
 *
 * Australia has no consolidated national fundraising-licence register —
 * each jurisdiction publishes its own (NSW Service NSW, VIC CAV, QLD OFT,
 * SA CBS, WA DEMIRS, TAS, ACT, NT). The /charity-check verdict screen
 * uses this map to render a "you may also want to check the {state}
 * register" deep-link when:
 *
 *   - the charity is ACNC-registered (so the federal cross-check passed)
 *   - AND the state requires a separate fundraising authority on top of
 *     ACNC registration (currently WA + TAS as of 2026-05; NSW joined the
 *     ACNC-only group from 1 April 2026 onward).
 *
 * NT has no fundraising-licence legislation at all, so it's omitted.
 *
 * Rationale for keeping this as a hand-maintained map rather than a
 * scraper: the regulatory surface changes once or twice a year per state
 * and is small enough that an out-of-date entry is a copy-edit, not a
 * data-pipeline incident. State-register scraping is deferred to v0.3
 * (per the strategy memo) for the high-volume jurisdictions that justify
 * automation (NSW, VIC, WA).
 */
export interface StateRegistrySource {
  /** Display label for the link. */
  label: string;
  /** URL to the public search page for that state's register. */
  url: string;
  /** True when ACNC registration is NOT sufficient on its own — donor
   *  should additionally verify the charity holds the state authority.
   *  False when the state recognises ACNC registration as sufficient. */
  requiresOwnLicence: boolean;
}

export const CHARITY_REGISTRY_SOURCES: Record<string, StateRegistrySource> = {
  NSW: {
    label: "NSW Service NSW (charitable fundraising)",
    url: "https://verify.licence.nsw.gov.au/?p=charity",
    // From 1 April 2026, ACNC charities are deemed to hold a NSW
    // fundraising authority — only non-ACNC entities/individuals/traders
    // need a separate licence.
    requiresOwnLicence: false,
  },
  VIC: {
    label: "Consumer Affairs Victoria fundraisers",
    url: "https://www.consumer.vic.gov.au/clubs-and-fundraising/fundraisers/search-for-a-registered-fundraiser",
    // ACNC charities only need to *notify* CAV; not licensed separately.
    requiresOwnLicence: false,
  },
  QLD: {
    label: "QLD Office of Fair Trading register",
    url: "https://www.qld.gov.au/community/your-rights-crime-and-the-law/your-rights-and-responsibilities/fundraising-and-charities",
    // ACNC charities only need to notify OFT (since 1 May 2023).
    requiresOwnLicence: false,
  },
  SA: {
    label: "SA Consumer and Business Services register",
    url: "https://www.cbs.sa.gov.au/services/check-business-occupation-licence-or-registration",
    // ACNC charities exempt; just notify CBS.
    requiresOwnLicence: false,
  },
  WA: {
    label: "WA DEMIRS list of licensed charities",
    url: "https://www.demirs.wa.gov.au/consumer-protection/charitable-collections-licences",
    // WA still requires its own Charitable Collections Licence
    // regardless of ACNC registration. This is the high-signal flag.
    requiresOwnLicence: true,
  },
  TAS: {
    label: "Tasmanian Government fundraising register",
    url: "https://www.justice.tas.gov.au/community/community-engagement/fundraising",
    // TAS still requires a state authority for some ACNC charities.
    requiresOwnLicence: true,
  },
  ACT: {
    label: "ACT Access Canberra (charitable collections)",
    url: "https://www.accesscanberra.act.gov.au/business-and-work/business/business-licences/charitable-collections-licence",
    // ACNC charities exempt since 2017.
    requiresOwnLicence: false,
  },
};

/**
 * Convenience helper for the verdict screen. Returns the registry-source
 * entry for a given state code (NSW/VIC/QLD/SA/WA/TAS/ACT/NT), or null
 * when the state has no separate register (NT).
 */
export function registrySourceForState(state: string | null | undefined): StateRegistrySource | null {
  if (!state) return null;
  return CHARITY_REGISTRY_SOURCES[state.toUpperCase()] ?? null;
}
