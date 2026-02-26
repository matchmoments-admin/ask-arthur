/**
 * Maps impersonated brand names (as returned by Claude analysis) to their
 * official Australian URLs. Used by the QR verdict overlay to offer a
 * "Visit the real [Brand]" button on HIGH_RISK impersonation verdicts.
 */

interface OfficialBrand {
  label: string;
  url: string;
}

const OFFICIAL_BRANDS: Record<string, OfficialBrand> = {
  // Government
  mygov: { label: "myGov", url: "https://my.gov.au" },
  ato: { label: "ATO", url: "https://www.ato.gov.au" },
  "australian taxation office": { label: "ATO", url: "https://www.ato.gov.au" },
  centrelink: { label: "Centrelink", url: "https://www.servicesaustralia.gov.au/centrelink" },
  medicare: { label: "Medicare", url: "https://www.servicesaustralia.gov.au/medicare" },
  "services australia": { label: "Services Australia", url: "https://www.servicesaustralia.gov.au" },
  "australia post": { label: "Australia Post", url: "https://auspost.com.au" },
  auspost: { label: "Australia Post", url: "https://auspost.com.au" },

  // Banks
  commbank: { label: "CommBank", url: "https://www.commbank.com.au" },
  "commonwealth bank": { label: "CommBank", url: "https://www.commbank.com.au" },
  nab: { label: "NAB", url: "https://www.nab.com.au" },
  "national australia bank": { label: "NAB", url: "https://www.nab.com.au" },
  westpac: { label: "Westpac", url: "https://www.westpac.com.au" },
  anz: { label: "ANZ", url: "https://www.anz.com.au" },
  "st george": { label: "St.George", url: "https://www.stgeorge.com.au" },
  "bank of melbourne": { label: "Bank of Melbourne", url: "https://www.bankofmelbourne.com.au" },
  bankwest: { label: "Bankwest", url: "https://www.bankwest.com.au" },

  // Telcos
  telstra: { label: "Telstra", url: "https://www.telstra.com.au" },
  optus: { label: "Optus", url: "https://www.optus.com.au" },
  vodafone: { label: "Vodafone", url: "https://www.vodafone.com.au" },
  tpg: { label: "TPG", url: "https://www.tpg.com.au" },

  // Delivery / Retail
  amazon: { label: "Amazon", url: "https://www.amazon.com.au" },
  ebay: { label: "eBay", url: "https://www.ebay.com.au" },
  "toll group": { label: "Toll", url: "https://www.toll.com.au" },

  // Utilities / Toll roads
  linkt: { label: "Linkt", url: "https://www.linkt.com.au" },
  etoll: { label: "E-Toll", url: "https://www.etoll.com.au" },

  // Tech
  paypal: { label: "PayPal", url: "https://www.paypal.com/au" },
  netflix: { label: "Netflix", url: "https://www.netflix.com" },
  apple: { label: "Apple", url: "https://www.apple.com/au" },
  google: { label: "Google", url: "https://www.google.com.au" },
  microsoft: { label: "Microsoft", url: "https://www.microsoft.com/en-au" },
};

/**
 * Look up the official brand info for an impersonated brand string.
 * Matching is case-insensitive.
 */
export function getOfficialBrand(impersonatedBrand: string): OfficialBrand | null {
  const key = impersonatedBrand.toLowerCase().trim();
  return OFFICIAL_BRANDS[key] ?? null;
}
