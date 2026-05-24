// AU brand watchlist for Layer 0 clone-watch (NRD daily ingest).
//
// Cross-surface dedupe in S0E.2 routes bank/telco/post hits that overlap
// ct-monitor.ts coverage to brand_impersonation_alerts instead of duplicating
// here — see ADR-0016 "different product surface" and shopfront-nrd-daily-ingest
// step 4. The signal is preserved; the storage discriminator is enforced
// at the seam, not by trimming the watchlist.
//
// legitimate_domains is the matcher's exclusion list — exact-string hits
// against these never produce an alert. Each brand SHOULD include the
// .com.au + .com.au.{state} + bare .com forms it actually operates on,
// so a domain like `bunnings.com.au` isn't reported as a clone of itself.

export interface BrandEntry {
  brand: string;
  legitimate_domains: string[];
}

export const AU_BRAND_WATCHLIST: BrandEntry[] = [
  // Retail — big-box
  { brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] },
  { brand: "Woolworths", legitimate_domains: ["woolworths.com.au"] },
  { brand: "Coles", legitimate_domains: ["coles.com.au"] },
  { brand: "Aldi", legitimate_domains: ["aldi.com.au"] },
  { brand: "IGA", legitimate_domains: ["iga.com.au"] },
  { brand: "Kmart", legitimate_domains: ["kmart.com.au"] },
  { brand: "Target", legitimate_domains: ["target.com.au"] },
  { brand: "Big W", legitimate_domains: ["bigw.com.au"] },
  { brand: "Myer", legitimate_domains: ["myer.com.au"] },
  { brand: "David Jones", legitimate_domains: ["davidjones.com"] },

  // Retail — electronics + hardware + homewares
  { brand: "JB Hi-Fi", legitimate_domains: ["jbhifi.com.au"] },
  { brand: "Harvey Norman", legitimate_domains: ["harveynorman.com.au"] },
  { brand: "Officeworks", legitimate_domains: ["officeworks.com.au"] },
  { brand: "Mitre 10", legitimate_domains: ["mitre10.com.au"] },
  { brand: "Reece", legitimate_domains: ["reece.com.au"] },

  // Retail — liquor + chemist
  { brand: "Dan Murphy's", legitimate_domains: ["danmurphys.com.au"] },
  { brand: "BWS", legitimate_domains: ["bws.com.au"] },
  { brand: "Liquorland", legitimate_domains: ["liquorland.com.au"] },
  { brand: "Chemist Warehouse", legitimate_domains: ["chemistwarehouse.com.au"] },
  { brand: "Priceline", legitimate_domains: ["priceline.com.au"] },

  // Logistics + post (overlap with ct-monitor.ts auspost keyword — handled by
  // cross-surface dedupe in shopfront-nrd-daily-ingest step 4).
  { brand: "Australia Post", legitimate_domains: ["auspost.com.au"] },
  { brand: "Toll", legitimate_domains: ["tollgroup.com", "mytoll.com"] },
  { brand: "StarTrack", legitimate_domains: ["startrack.com.au"] },
  { brand: "Sendle", legitimate_domains: ["sendle.com"] },

  // QSR
  { brand: "Domino's", legitimate_domains: ["dominos.com.au"] },
  { brand: "McDonald's", legitimate_domains: ["mcdonalds.com.au"] },
  { brand: "KFC", legitimate_domains: ["kfc.com.au"] },
  { brand: "Hungry Jack's", legitimate_domains: ["hungryjacks.com.au"] },
  { brand: "Subway", legitimate_domains: ["subway.com.au"] },
  { brand: "7-Eleven", legitimate_domains: ["7eleven.com.au"] },

  // Fashion + apparel
  { brand: "Smiggle", legitimate_domains: ["smiggle.com.au"] },
  { brand: "Cotton On", legitimate_domains: ["cottonon.com"] },
  { brand: "Bonds", legitimate_domains: ["bonds.com.au"] },
  { brand: "Country Road", legitimate_domains: ["countryroad.com.au"] },
  { brand: "Witchery", legitimate_domains: ["witchery.com.au"] },
  { brand: "Sportsgirl", legitimate_domains: ["sportsgirl.com.au"] },
  { brand: "Glue Store", legitimate_domains: ["gluestore.com.au"] },
  { brand: "Universal Store", legitimate_domains: ["universalstore.com"] },
  { brand: "City Beach", legitimate_domains: ["citybeach.com.au"] },
  { brand: "Surfstitch", legitimate_domains: ["surfstitch.com"] },
  { brand: "Toyworld", legitimate_domains: ["toyworld.com.au"] },

  // Banks (overlap with ct-monitor.ts commbank/nab/westpac keywords — cross-surface
  // dedupe routes overlapping URL hits to brand_impersonation_alerts).
  { brand: "Westpac", legitimate_domains: ["westpac.com.au"] },
  { brand: "NAB", legitimate_domains: ["nab.com.au"] },
  { brand: "ANZ", legitimate_domains: ["anz.com.au"] },
  { brand: "CBA", legitimate_domains: ["commbank.com.au"] },

  // Telcos (overlap with ct-monitor.ts telstra keyword — same dedupe path).
  { brand: "Telstra", legitimate_domains: ["telstra.com.au"] },
  { brand: "Optus", legitimate_domains: ["optus.com.au"] },
  { brand: "Vodafone", legitimate_domains: ["vodafone.com.au"] },
];
