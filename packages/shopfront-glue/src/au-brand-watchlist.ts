// AU brand watchlist for Layer 0 clone-watch (NRD daily ingest).
//
// Banks/telcos/post are retained alongside the consumer-extension
// ct-monitor.ts coverage. The cross-surface dedupe step was dropped
// from MVP scope (see canonicalise.ts header for context — the
// brand_impersonation_alerts table has no candidate_url column). For
// the ~6-12 bank/telco/post brands on this list, accept that Layer 0
// and ct-monitor.ts may report the same suspect domain on two
// surfaces during the 7-day MVP evidence window. If duplicate noise
// becomes material, a follow-up migration adds candidate_url to
// brand_impersonation_alerts and reintroduces dedupe.
//
// legitimate_domains is the matcher's exclusion list — exact-string hits
// against these never produce an alert. Each brand SHOULD include every
// real domain it operates on so a domain like `davidjones.com.au` isn't
// reported as a clone of itself.

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
  { brand: "David Jones", legitimate_domains: ["davidjones.com.au", "davidjones.com"] },

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

  // ── PR-B (Phase 1) expansion: +47 brands across high-impersonation
  // sectors that the original list missed. See
  // docs/research/clone-watch-brand-contacts.md for provenance + the
  // per-brand security/abuse contacts seeded into
  // brand_contact_directory by migration v150.

  // Government services — ACSC's recurring top-impersonation list.
  { brand: "myGov", legitimate_domains: ["my.gov.au"] },
  { brand: "Australian Taxation Office", legitimate_domains: ["ato.gov.au"] },
  {
    brand: "Services Australia",
    legitimate_domains: [
      "servicesaustralia.gov.au",
      "centrelink.gov.au",
      "medicareaustralia.gov.au",
    ],
  },
  { brand: "Service NSW", legitimate_domains: ["service.nsw.gov.au"] },
  { brand: "Service Victoria", legitimate_domains: ["service.vic.gov.au"] },
  { brand: "Service WA", legitimate_domains: ["wa.gov.au"] },
  {
    brand: "Department of Home Affairs",
    legitimate_domains: ["homeaffairs.gov.au", "immi.homeaffairs.gov.au"],
  },
  {
    brand: "NDIS",
    legitimate_domains: ["ndis.gov.au", "ndiscommission.gov.au"],
  },
  { brand: "Australian Electoral Commission", legitimate_domains: ["aec.gov.au"] },
  { brand: "Reserve Bank of Australia", legitimate_domains: ["rba.gov.au"] },

  // Energy retailers — recurring refund/disconnect-threat phishing template.
  { brand: "AGL", legitimate_domains: ["agl.com.au"] },
  { brand: "Origin Energy", legitimate_domains: ["originenergy.com.au"] },
  { brand: "EnergyAustralia", legitimate_domains: ["energyaustralia.com.au"] },
  { brand: "Red Energy", legitimate_domains: ["redenergy.com.au"] },
  { brand: "Alinta Energy", legitimate_domains: ["alintaenergy.com.au"] },
  { brand: "Powershop", legitimate_domains: ["powershop.com.au"] },
  { brand: "Simply Energy", legitimate_domains: ["simplyenergy.com.au"] },

  // Airlines + travel — voucher/refund + rewards-points phishing.
  { brand: "Qantas", legitimate_domains: ["qantas.com.au", "qantas.com"] },
  { brand: "Virgin Australia", legitimate_domains: ["virginaustralia.com"] },
  { brand: "Jetstar", legitimate_domains: ["jetstar.com"] },
  { brand: "Webjet", legitimate_domains: ["webjet.com.au"] },
  {
    brand: "Flight Centre",
    legitimate_domains: ["flightcentre.com.au", "flightcentre.com"],
  },
  { brand: "Booking.com", legitimate_domains: ["booking.com"] },
  { brand: "Wotif", legitimate_domains: ["wotif.com"] },

  // Health insurers — premium-refund / claim-update phishing.
  { brand: "Bupa", legitimate_domains: ["bupa.com.au"] },
  { brand: "Medibank", legitimate_domains: ["medibank.com.au"] },
  { brand: "HCF", legitimate_domains: ["hcf.com.au"] },
  { brand: "NIB", legitimate_domains: ["nib.com.au"] },
  { brand: "AHM", legitimate_domains: ["ahm.com.au"] },
  { brand: "HBF", legitimate_domains: ["hbf.com.au"] },

  // Crypto exchanges — account-takeover + transfer-recovery scams.
  {
    brand: "Binance Australia",
    legitimate_domains: ["binance.com", "binance.com.au"],
  },
  { brand: "CoinSpot", legitimate_domains: ["coinspot.com.au"] },
  { brand: "Independent Reserve", legitimate_domains: ["independentreserve.com"] },
  { brand: "Swyftx", legitimate_domains: ["swyftx.com"] },
  { brand: "BTC Markets", legitimate_domains: ["btcmarkets.net"] },
  { brand: "Digital Surge", legitimate_domains: ["digitalsurge.com.au"] },

  // Investment platforms — refund/withdrawal phishing.
  {
    brand: "CommSec",
    legitimate_domains: ["commsec.com.au"],
  },
  { brand: "Stake", legitimate_domains: ["hellostake.com"] },
  { brand: "SelfWealth", legitimate_domains: ["selfwealth.com.au"] },
  { brand: "Superhero", legitimate_domains: ["superhero.com.au"] },
  { brand: "Pearler", legitimate_domains: ["pearler.com"] },

  // Tolls / public-transport cards — SMS-bill + top-up phishing. Linkt is
  // top-3 most-impersonated AU brand 2024 per Scamwatch.
  { brand: "Linkt (Transurban)", legitimate_domains: ["linkt.com.au"] },
  { brand: "EastLink", legitimate_domains: ["eastlink.com.au"] },
  {
    brand: "Opal (Transport for NSW)",
    legitimate_domains: ["transportnsw.info", "opal.com.au"],
  },
  {
    brand: "myki (Public Transport Victoria)",
    legitimate_domains: ["ptv.vic.gov.au", "mymyki.com.au"],
  },
  { brand: "Translink (Queensland)", legitimate_domains: ["translink.com.au"] },

  // Real estate / classifieds — rental-bond + private-seller-escrow fraud.
  {
    brand: "realestate.com.au",
    legitimate_domains: [
      "realestate.com.au",
      "property.com.au",
      "realcommercial.com.au",
    ],
  },
  {
    brand: "Domain",
    legitimate_domains: ["domain.com.au", "allhomes.com.au"],
  },
  {
    brand: "Carsales",
    legitimate_domains: [
      "carsales.com.au",
      "redbook.com.au",
      "bikesales.com.au",
    ],
  },
  { brand: "Gumtree", legitimate_domains: ["gumtree.com.au"] },

  // Streaming — subscription-renewal phishing (global top-5 globally).
  {
    brand: "Foxtel / Kayo",
    legitimate_domains: [
      "foxtel.com.au",
      "kayosports.com.au",
      "binge.com.au",
      "hubbl.com.au",
    ],
  },
  { brand: "Netflix (AU)", legitimate_domains: ["netflix.com"] },
  { brand: "Spotify (AU)", legitimate_domains: ["spotify.com"] },
  { brand: "Stan", legitimate_domains: ["stan.com.au"] },
  {
    brand: "Disney+ (AU)",
    legitimate_domains: ["disneyplus.com", "disney.com.au"],
  },

  // E-commerce — marketplace + order-confirm phishing.
  { brand: "eBay Australia", legitimate_domains: ["ebay.com.au"] },
  { brand: "Kogan", legitimate_domains: ["kogan.com"] },
  { brand: "MyDeal", legitimate_domains: ["mydeal.com.au"] },
];
