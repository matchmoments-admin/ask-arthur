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
  // Optional extra match tokens (short-forms / trading names) matched in
  // ADDITION to `brand`. Needed where the official brand normalises to a
  // token that real clones never use — e.g. "CBA" → "cba" misses
  // `commbank-login.shop`, "Australia Post" → "australiapost" misses
  // `auspost-redelivery.shop`. Each alias goes through the same
  // confusable/substring/Levenshtein path as the brand and reports under the
  // canonical `brand`. Keep aliases ≥5 chars and distinctive — a generic
  // alias (e.g. "booking", "circle") reintroduces the dictionary-word FP
  // class the scam-context gate exists to suppress.
  aliases?: string[];
  // Certificate-Transparency firehose config. When present, this brand is
  // swept by ct-monitor.ts against crt.sh under `ct.keyword` — a distinctive
  // lowercase token that must be specific enough not to match unrelated certs
  // via crt.sh's `%keyword%` wildcard (this is why generic short tokens like
  // "anz"/"agl"/"amp" are deliberately NOT given a `ct` entry — they'd flood
  // the firehose). `tier` gates rollout: 'core' is the original always-on
  // keyword set, 'expanded' only fires when FF_CT_MONITOR_EXPANDED is enabled,
  // so the research-driven concentrated-target expansion ships as a reversible,
  // no-regression flag flip. The legitimate_domains union (across ALL brands,
  // not just CT-eligible ones) is the firehose's exclusion list — see
  // getCtMonitorConfig.
  ct?: { keyword: string; tier: "core" | "expanded" };
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
  {
    brand: "Australia Post",
    legitimate_domains: ["auspost.com.au"],
    aliases: ["auspost"],
    ct: { keyword: "auspost", tier: "core" },
  },
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
  {
    brand: "Westpac",
    legitimate_domains: ["westpac.com.au"],
    ct: { keyword: "westpac", tier: "core" },
  },
  {
    brand: "NAB",
    legitimate_domains: ["nab.com.au"],
    ct: { keyword: "nab", tier: "core" },
  },
  { brand: "ANZ", legitimate_domains: ["anz.com.au", "anz.com"] },
  {
    brand: "CBA",
    legitimate_domains: ["commbank.com.au"],
    aliases: ["commbank"],
    ct: { keyword: "commbank", tier: "core" },
  },

  // Telcos (overlap with ct-monitor.ts telstra keyword — same dedupe path).
  {
    brand: "Telstra",
    legitimate_domains: ["telstra.com.au", "telstra.com"],
    ct: { keyword: "telstra", tier: "core" },
  },
  {
    brand: "Optus",
    legitimate_domains: ["optus.com.au"],
    ct: { keyword: "optus", tier: "expanded" },
  },
  {
    // National Broadband Network — heavily impersonated for "outage refund" /
    // "router upgrade" SMS phishing. "nbn" (3 chars) floods the firehose, so
    // gate the distinctive "nbnco" token behind the expanded tier.
    brand: "NBN Co",
    legitimate_domains: ["nbnco.com.au", "nbn.com.au"],
    aliases: ["nbnco"],
    ct: { keyword: "nbnco", tier: "expanded" },
  },
  {
    brand: "Vodafone",
    legitimate_domains: ["vodafone.com.au"],
    ct: { keyword: "vodafone", tier: "expanded" },
  },

  // ── PR-B (Phase 1) expansion: +47 brands across high-impersonation
  // sectors that the original list missed. See
  // docs/research/clone-watch-brand-contacts.md for provenance + the
  // per-brand security/abuse contacts seeded into
  // brand_contact_directory by migration v150.

  // Government services — ACSC's recurring top-impersonation list.
  {
    brand: "myGov",
    legitimate_domains: ["my.gov.au", "mygov.au"],
    ct: { keyword: "mygov", tier: "core" },
  },
  {
    brand: "Australian Taxation Office",
    legitimate_domains: ["ato.gov.au"],
    ct: { keyword: "ato.gov", tier: "core" },
  },
  {
    brand: "Services Australia",
    legitimate_domains: [
      "servicesaustralia.gov.au",
      "centrelink.gov.au",
      "medicareaustralia.gov.au",
    ],
    ct: { keyword: "centrelink", tier: "core" },
  },
  {
    brand: "Service NSW",
    legitimate_domains: ["service.nsw.gov.au"],
    ct: { keyword: "servicensw", tier: "core" },
  },
  { brand: "Service Victoria", legitimate_domains: ["service.vic.gov.au"] },
  { brand: "Service WA", legitimate_domains: ["wa.gov.au"] },
  {
    brand: "Service Queensland",
    legitimate_domains: ["service.qld.gov.au", "qld.gov.au"],
  },
  {
    brand: "Department of Home Affairs",
    legitimate_domains: ["homeaffairs.gov.au", "immi.homeaffairs.gov.au"],
  },
  {
    brand: "NDIS",
    legitimate_domains: ["ndis.gov.au", "ndiscommission.gov.au"],
    ct: { keyword: "ndis", tier: "expanded" },
  },
  { brand: "Australian Electoral Commission", legitimate_domains: ["aec.gov.au"] },
  { brand: "Reserve Bank of Australia", legitimate_domains: ["rba.gov.au"] },
  {
    // Corporate regulator — recurring "company renewal fee" / "business name
    // invoice" phishing target. "asic" alone is too generic for the CT firehose
    // (collides with application-specific-integrated-circuit certs), so no ct.
    brand: "Australian Securities and Investments Commission",
    legitimate_domains: ["asic.gov.au"],
    aliases: ["asic.gov"],
  },

  // Energy retailers — recurring refund/disconnect-threat phishing template.
  { brand: "AGL", legitimate_domains: ["agl.com.au"] },
  {
    brand: "Origin Energy",
    legitimate_domains: ["originenergy.com.au"],
    ct: { keyword: "originenergy", tier: "expanded" },
  },
  {
    brand: "EnergyAustralia",
    legitimate_domains: ["energyaustralia.com.au"],
    ct: { keyword: "energyaustralia", tier: "expanded" },
  },
  { brand: "Red Energy", legitimate_domains: ["redenergy.com.au"] },
  { brand: "Alinta Energy", legitimate_domains: ["alintaenergy.com.au"] },
  { brand: "Powershop", legitimate_domains: ["powershop.com.au"] },
  { brand: "Simply Energy", legitimate_domains: ["simplyenergy.com.au"] },

  // Airlines + travel — voucher/refund + rewards-points phishing.
  {
    brand: "Qantas",
    legitimate_domains: ["qantas.com.au", "qantas.com"],
    ct: { keyword: "qantas", tier: "expanded" },
  },
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
  {
    brand: "Bupa",
    legitimate_domains: ["bupa.com.au"],
    ct: { keyword: "bupa", tier: "expanded" },
  },
  {
    brand: "Medibank",
    legitimate_domains: ["medibank.com.au"],
    ct: { keyword: "medibank", tier: "expanded" },
  },
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
  {
    brand: "Linkt (Transurban)",
    legitimate_domains: ["linkt.com.au"],
    ct: { keyword: "linkt", tier: "expanded" },
  },
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

  // Social / tech platforms — credential phishing. Meta logins are cloned
  // heavily to harvest passwords (fake "your account will be disabled" /
  // "confirm your Facebook" pages), and Facebook Marketplace is a primary
  // vector for the AU scams Ask Arthur's bots field. The `brand` token
  // ("facebook"/"instagram") is exactly what clones use, so no alias is
  // needed; real Meta domains are excluded via legitimate_domains. CT is
  // 'expanded' tier — flag-gated rollout via FF_CT_MONITOR_EXPANDED.
  {
    brand: "Facebook",
    legitimate_domains: ["facebook.com", "m.facebook.com", "fb.com"],
    ct: { keyword: "facebook", tier: "expanded" },
  },
  {
    brand: "Instagram",
    legitimate_domains: ["instagram.com"],
    ct: { keyword: "instagram", tier: "expanded" },
  },

  // ── PR-J expansion (2026-05-29): smaller banking / lender / telco / super
  // brands. Web-researched + domain-verified. Curated for the matcher:
  // multi-word names keep their concatenated token; `aliases` carry the
  // distinctive short-form a clone actually uses (e.g. "macquarie", "boq").
  // Deliberately NO generic short tokens ("up", "aussie", "rest") as bare
  // brands — they'd reintroduce the dictionary-word FP class the scam-context
  // gate exists to suppress (so "Up" → brand "Up Bank" + alias "upbank").

  // Banks + neobanks
  { brand: "Up Bank", legitimate_domains: ["up.com.au"], aliases: ["upbank"] },
  { brand: "Ubank", legitimate_domains: ["ubank.com.au"] },
  {
    brand: "ING Australia",
    legitimate_domains: ["ing.com.au", "ingdirect.com.au"],
    aliases: ["ingdirect"],
  },
  {
    brand: "Macquarie Bank",
    legitimate_domains: ["macquarie.com.au"],
    aliases: ["macquarie"],
    ct: { keyword: "macquarie", tier: "expanded" },
  },
  {
    brand: "Bankwest",
    legitimate_domains: ["bankwest.com.au"],
    ct: { keyword: "bankwest", tier: "expanded" },
  },
  {
    brand: "St.George Bank",
    legitimate_domains: ["stgeorge.com.au"],
    aliases: ["stgeorge"],
  },
  { brand: "Bank of Melbourne", legitimate_domains: ["bankofmelbourne.com.au"] },
  { brand: "BankSA", legitimate_domains: ["banksa.com.au"] },
  {
    brand: "Suncorp",
    legitimate_domains: ["suncorp.com.au", "suncorpbank.com.au"],
    ct: { keyword: "suncorp", tier: "expanded" },
  },
  {
    brand: "Bendigo Bank",
    legitimate_domains: ["bendigobank.com.au"],
    ct: { keyword: "bendigobank", tier: "expanded" },
  },
  {
    brand: "Bank of Queensland",
    legitimate_domains: ["boq.com.au"],
    aliases: ["boq"],
  },
  { brand: "ME Bank", legitimate_domains: ["mebank.com.au"] },
  { brand: "Judo Bank", legitimate_domains: ["judo.bank"] },
  { brand: "Virgin Money", legitimate_domains: ["virginmoney.com.au"] },

  // Mutual / customer-owned banks
  {
    brand: "Great Southern Bank",
    legitimate_domains: ["greatsouthernbank.com.au"],
  },
  { brand: "Heritage Bank", legitimate_domains: ["heritage.com.au"] },
  {
    brand: "Newcastle Permanent",
    legitimate_domains: ["newcastlepermanent.com.au"],
  },
  { brand: "P&N Bank", legitimate_domains: ["pnbank.com.au"], aliases: ["pnbank"] },
  { brand: "Beyond Bank", legitimate_domains: ["beyondbank.com.au"] },
  {
    brand: "Bank Australia",
    legitimate_domains: ["bankaust.com.au"],
    aliases: ["bankaust"],
  },
  {
    brand: "Teachers Mutual Bank",
    legitimate_domains: ["tmbank.com.au"],
    aliases: ["tmbank"],
  },
  { brand: "Qudos Bank", legitimate_domains: ["qudosbank.com.au"] },
  { brand: "Greater Bank", legitimate_domains: ["greater.com.au"] },
  { brand: "People First Bank", legitimate_domains: ["peoplefirstbank.com.au"] },
  { brand: "Police Bank", legitimate_domains: ["policebank.com.au"] },
  { brand: "Unity Bank", legitimate_domains: ["unitybank.com.au"] },
  { brand: "UniBank", legitimate_domains: ["unibank.com.au"] },
  { brand: "Firefighters Mutual Bank", legitimate_domains: ["fmbank.com.au"] },
  { brand: "Health Professionals Bank", legitimate_domains: ["hpbank.com.au"] },
  {
    brand: "Australian Military Bank",
    legitimate_domains: ["australianmilitarybank.com.au"],
  },

  // Mortgage brokers + home-loan lenders
  { brand: "Aussie Home Loans", legitimate_domains: ["aussie.com.au"] },
  { brand: "Mortgage Choice", legitimate_domains: ["mortgagechoice.com.au"] },
  { brand: "Athena Home Loans", legitimate_domains: ["athena.com.au"] },
  { brand: "Unloan", legitimate_domains: ["unloan.com.au"] },
  {
    brand: "Tiimely Home",
    legitimate_domains: ["tiimelyhome.com.au", "tictoc.com.au"],
  },
  { brand: "Pepper Money", legitimate_domains: ["peppermoney.com.au"] },
  { brand: "Liberty Financial", legitimate_domains: ["liberty.com.au"] },
  {
    brand: "Resimac",
    legitimate_domains: ["resimac.com.au", "homeloans.com.au"],
  },
  { brand: "La Trobe Financial", legitimate_domains: ["latrobefinancial.com.au"] },
  { brand: "Firstmac", legitimate_domains: ["firstmac.com.au"] },
  { brand: "loans.com.au", legitimate_domains: ["loans.com.au"] },

  // SME / business lenders
  { brand: "Valiant Finance", legitimate_domains: ["valiantfinance.com"] },
  { brand: "Prospa", legitimate_domains: ["prospa.com"] },
  { brand: "Lumi", legitimate_domains: ["lumi.com.au"] },
  { brand: "Moula", legitimate_domains: ["moula.com.au"] },
  { brand: "OnDeck", legitimate_domains: ["ondeck.com.au"] },
  { brand: "Banjo Loans", legitimate_domains: ["banjoloans.com"] },
  { brand: "Bigstone", legitimate_domains: ["bigstone.com.au"] },
  { brand: "Zeller", legitimate_domains: ["myzeller.com"] },

  // BNPL + consumer finance
  {
    brand: "Afterpay",
    legitimate_domains: ["afterpay.com"],
    ct: { keyword: "afterpay", tier: "expanded" },
  },
  { brand: "Zip", legitimate_domains: ["zip.co"] },
  { brand: "Humm", legitimate_domains: ["shophumm.com", "hummloan.com"] },
  {
    brand: "Latitude Financial",
    legitimate_domains: ["latitudefinancial.com.au"],
  },
  { brand: "Klarna", legitimate_domains: ["klarna.com"] },
  { brand: "Beforepay", legitimate_domains: ["beforepay.com.au"] },
  { brand: "Wisr", legitimate_domains: ["wisr.com.au"] },
  { brand: "MoneyMe", legitimate_domains: ["moneyme.com.au"] },
  { brand: "Nimble", legitimate_domains: ["nimble.com.au"] },
  { brand: "Cash Converters", legitimate_domains: ["cashconverters.com.au"] },
  { brand: "Harmoney", legitimate_domains: ["harmoney.com.au"] },

  // Telcos + ISPs (MVNOs phished via bill / top-up SMS)
  { brand: "Belong", legitimate_domains: ["belong.com.au"] },
  { brand: "Boost Mobile", legitimate_domains: ["boost.com.au"] },
  { brand: "Amaysim", legitimate_domains: ["amaysim.com.au"] },
  { brand: "Aussie Broadband", legitimate_domains: ["aussiebroadband.com.au"] },
  { brand: "TPG", legitimate_domains: ["tpg.com.au"] },
  { brand: "iiNet", legitimate_domains: ["iinet.net.au"] },
  { brand: "Dodo", legitimate_domains: ["dodo.com"] },
  { brand: "Tangerine", legitimate_domains: ["tangerine.com.au"] },
  { brand: "Felix Mobile", legitimate_domains: ["felixmobile.com.au"] },
  { brand: "Superloop", legitimate_domains: ["superloop.com"] },
  { brand: "Southern Phone", legitimate_domains: ["southernphone.com.au"] },
  { brand: "Exetel", legitimate_domains: ["exetel.com.au"] },
  { brand: "SpinTel", legitimate_domains: ["spintel.net.au"] },
  { brand: "Kogan Mobile", legitimate_domains: ["koganmobile.com.au"] },
  { brand: "Moose Mobile", legitimate_domains: ["moosemobile.com.au"] },

  // Super funds + investing (refund / consolidation phishing)
  {
    brand: "AustralianSuper",
    legitimate_domains: ["australiansuper.com"],
    ct: { keyword: "australiansuper", tier: "expanded" },
  },
  {
    brand: "Australian Retirement Trust",
    legitimate_domains: ["australianretirementtrust.com.au"],
  },
  { brand: "Aware Super", legitimate_domains: ["aware.com.au"] },
  {
    brand: "Hostplus",
    legitimate_domains: ["hostplus.com.au"],
    ct: { keyword: "hostplus", tier: "expanded" },
  },
  { brand: "REST Super", legitimate_domains: ["rest.com.au"] },
  { brand: "HESTA", legitimate_domains: ["hesta.com.au"] },
  { brand: "Cbus", legitimate_domains: ["cbussuper.com.au"] },
  {
    brand: "UniSuper",
    legitimate_domains: ["unisuper.com.au"],
    ct: { keyword: "unisuper", tier: "expanded" },
  },
  {
    brand: "Colonial First State",
    legitimate_domains: ["cfs.com.au"],
    aliases: ["cfs"],
  },
  { brand: "MLC", legitimate_domains: ["mlc.com.au"] },
  { brand: "AMP", legitimate_domains: ["amp.com.au"] },
  { brand: "Australian Ethical", legitimate_domains: ["australianethical.com.au"] },
  { brand: "Spaceship", legitimate_domains: ["spaceship.com.au"] },
  { brand: "Raiz", legitimate_domains: ["raizinvest.com.au"] },
  { brand: "Verve Super", legitimate_domains: ["vervesuper.com.au"] },

  // Payments + money-transfer fintech (PayID / transfer-recovery scams)
  { brand: "Wise", legitimate_domains: ["wise.com"] },
  { brand: "Revolut", legitimate_domains: ["revolut.com"] },
  { brand: "PayPal", legitimate_domains: ["paypal.com"] },
  { brand: "BPAY", legitimate_domains: ["bpay.com.au"] },
  { brand: "Beem", legitimate_domains: ["beemit.com.au"] },
  { brand: "Airwallex", legitimate_domains: ["airwallex.com"] },

  // General insurance (claim / premium-refund phishing)
  { brand: "NRMA", legitimate_domains: ["nrma.com.au"] },
  { brand: "RACV", legitimate_domains: ["racv.com.au"] },
  { brand: "RACQ", legitimate_domains: ["racq.com.au"] },
  { brand: "AAMI", legitimate_domains: ["aami.com.au"] },
  { brand: "Allianz", legitimate_domains: ["allianz.com.au"] },
  { brand: "Budget Direct", legitimate_domains: ["budgetdirect.com.au"] },
  { brand: "Youi", legitimate_domains: ["youi.com.au"] },
  { brand: "QBE", legitimate_domains: ["qbe.com", "qbe.com.au"] },
  { brand: "GIO", legitimate_domains: ["gio.com.au"] },

  // ── PR-K expansion (2026-06-15): global finance/consulting + tech giants +
  // couriers/crypto + police forces + gov agencies. Curated against the AU
  // most-impersonated research (ASIC bond/term-deposit scams, ACSC/Scamwatch
  // impersonation alerts, courier/parcel smishing). FP discipline: distinctive
  // ≥5-char tokens get the full matcher; dangerous SHORT acronyms (EY=2,
  // AFP/ABF/BCG/DVA=3) are added as their SPELLED-OUT brand so the matcher's
  // <5-char gate + scam-context gate don't flood (the dictionary-word FP class
  // the gate exists to suppress). Any that still flood get FP-denylisted like
  // domain.com.au/lendi.com.au did.

  // Tech giants — tech-support + account-suspension + verification-code scams
  { brand: "Amazon", legitimate_domains: ["amazon.com.au", "amazon.com"] },
  { brand: "Apple", legitimate_domains: ["apple.com", "icloud.com"] },
  { brand: "Microsoft", legitimate_domains: ["microsoft.com", "outlook.com", "live.com"] },
  { brand: "Google", legitimate_domains: ["google.com", "google.com.au", "gmail.com"] },
  { brand: "WhatsApp", legitimate_domains: ["whatsapp.com"] },

  // Couriers — parcel "customs fee / redelivery" smishing (top alongside AusPost)
  { brand: "DHL", legitimate_domains: ["dhl.com", "dhl.com.au"] },
  { brand: "FedEx", legitimate_domains: ["fedex.com"] },
  { brand: "Aramex Australia", legitimate_domains: ["aramex.com.au", "aramex.com"], aliases: ["aramex"] },
  { brand: "CouriersPlease", legitimate_domains: ["couriersplease.com.au"] },

  // Crypto exchanges — account-takeover + spoofed-verification SMS (AFP-warned)
  { brand: "Coinbase", legitimate_domains: ["coinbase.com"] },
  { brand: "Kraken", legitimate_domains: ["kraken.com"] },
  { brand: "Crypto.com", legitimate_domains: ["crypto.com"] },

  // Global asset managers — ASIC-confirmed imposter bond / term-deposit scams
  { brand: "BlackRock", legitimate_domains: ["blackrock.com", "blackrock.com.au"] },
  { brand: "Vanguard", legitimate_domains: ["vanguard.com.au", "vanguard.com"] },
  { brand: "Fidelity", legitimate_domains: ["fidelity.com.au", "fidelity.com"] },
  { brand: "State Street", legitimate_domains: ["statestreet.com"] },
  { brand: "PIMCO", legitimate_domains: ["pimco.com", "pimco.com.au"] },
  { brand: "T. Rowe Price", legitimate_domains: ["troweprice.com"], aliases: ["troweprice"] },

  // Global banks — fake bond/term-deposit + recruitment scams
  { brand: "JP Morgan", legitimate_domains: ["jpmorgan.com", "jpmorganchase.com"], aliases: ["jpmorgan", "jpmorganchase"] },
  { brand: "Citibank", legitimate_domains: ["citibank.com.au", "citi.com"], aliases: ["citibank"] },
  { brand: "HSBC", legitimate_domains: ["hsbc.com.au", "hsbc.com"] },
  { brand: "Goldman Sachs", legitimate_domains: ["goldmansachs.com", "gs.com"], aliases: ["goldmansachs"] },
  { brand: "Morgan Stanley", legitimate_domains: ["morganstanley.com"], aliases: ["morganstanley"] },
  { brand: "Standard Chartered", legitimate_domains: ["standardchartered.com", "sc.com"], aliases: ["standardchartered"] },
  { brand: "Deutsche Bank", legitimate_domains: ["db.com", "deutsche-bank.com"], aliases: ["deutschebank"] },
  { brand: "UBS", legitimate_domains: ["ubs.com"] },

  // Big-4 + consulting — fake-recruitment / job-offer scams (WA ScamNet)
  { brand: "Deloitte", legitimate_domains: ["deloitte.com", "deloitte.com.au"] },
  { brand: "KPMG", legitimate_domains: ["kpmg.com", "kpmg.com.au"] },
  { brand: "PwC", legitimate_domains: ["pwc.com", "pwc.com.au"] },
  { brand: "EY", legitimate_domains: ["ey.com", "ey.com.au"] }, // 2-char token — FP-watch
  { brand: "Accenture", legitimate_domains: ["accenture.com"] },
  { brand: "McKinsey", legitimate_domains: ["mckinsey.com"] },
  { brand: "Boston Consulting Group", legitimate_domains: ["bcg.com"], aliases: ["bostonconsulting"] },
  { brand: "Bain & Company", legitimate_domains: ["bain.com"], aliases: ["baincompany"] },

  // High-volume shopping — fake-order/refund + counterfeit-store phishing
  { brand: "Shein", legitimate_domains: ["shein.com", "shein.com.au"] },
  { brand: "Temu", legitimate_domains: ["temu.com"] },
  { brand: "AliExpress", legitimate_domains: ["aliexpress.com"] },

  // Money transfer — romance/advance-fee payout rails
  { brand: "Western Union", legitimate_domains: ["westernunion.com"], aliases: ["westernunion"] },
  { brand: "MoneyGram", legitimate_domains: ["moneygram.com"] },
  { brand: "EziDebit", legitimate_domains: ["ezidebit.com.au", "ezidebit.com"] },

  // Parking apps — "unpaid parking fee" smishing (same wave as Linkt tolls)
  { brand: "EasyPark", legitimate_domains: ["easypark.com", "easyparkgroup.com"] },
  { brand: "CellOPark", legitimate_domains: ["cellopark.com.au"] },

  // Police forces — fake fine / warrant / arrest-threat scams. Spelled-out
  // (bare AFP/QPS would flood). "Police Bank" already on the list is a BANK.
  { brand: "Australian Federal Police", legitimate_domains: ["afp.gov.au"] },
  { brand: "NSW Police", legitimate_domains: ["police.nsw.gov.au"] },
  { brand: "Victoria Police", legitimate_domains: ["police.vic.gov.au"] },
  { brand: "Queensland Police", legitimate_domains: ["police.qld.gov.au"] },
  { brand: "WA Police", legitimate_domains: ["police.wa.gov.au"] },
  { brand: "South Australia Police", legitimate_domains: ["police.sa.gov.au"], aliases: ["sapol"] },
  { brand: "Tasmania Police", legitimate_domains: ["police.tas.gov.au"] },
  { brand: "ACT Policing", legitimate_domains: ["police.act.gov.au"] },

  // Federal agencies — benefit/refund + visa + warrant + "verify identity" scams
  { brand: "Medicare", legitimate_domains: ["servicesaustralia.gov.au", "my.gov.au"] },
  { brand: "Centrelink", legitimate_domains: ["servicesaustralia.gov.au", "my.gov.au"] },
  { brand: "Australian Border Force", legitimate_domains: ["abf.gov.au", "border.gov.au"] },
  { brand: "Australian Passport Office", legitimate_domains: ["passports.gov.au"] },
  { brand: "AHPRA", legitimate_domains: ["ahpra.gov.au"] },
  { brand: "Scamwatch", legitimate_domains: ["scamwatch.gov.au"] },
  { brand: "AUSTRAC", legitimate_domains: ["austrac.gov.au"] },
  { brand: "eSafety Commissioner", legitimate_domains: ["esafety.gov.au"], aliases: ["esafety"] },
  { brand: "Fair Work Ombudsman", legitimate_domains: ["fairwork.gov.au"], aliases: ["fairwork"] },
  { brand: "Department of Veterans' Affairs", legitimate_domains: ["dva.gov.au"], aliases: ["veteransaffairs"] },
  { brand: "Australian Cyber Security Centre", legitimate_domains: ["cyber.gov.au"] },
  { brand: "IP Australia", legitimate_domains: ["ipaustralia.gov.au"] },
  { brand: "Department of Health and Aged Care", legitimate_domains: ["health.gov.au"] },

  // State revenue / transport — "unpaid fine / infringement / rego" scams
  { brand: "Revenue NSW", legitimate_domains: ["revenue.nsw.gov.au"] },
  { brand: "Fines Victoria", legitimate_domains: ["fines.vic.gov.au"] },
  { brand: "VicRoads", legitimate_domains: ["vicroads.vic.gov.au"] },
  { brand: "Transport for NSW", legitimate_domains: ["transport.nsw.gov.au"] },
];

export interface CtMonitorConfig {
  /** crt.sh keyword + the canonical brand it reports under. */
  keywords: { keyword: string; brand: string }[];
  /** Exclusion set: a cert CN equal to (or a subdomain of) any of these is
   *  the brand's own cert, not a clone. Built from the union of ALL brands'
   *  legitimate_domains — not just the CT-eligible ones — so a hit on the
   *  `commbank` keyword that happens to surface `anz.com.au` is still
   *  excluded. */
  legitimateDomains: string[];
}

/**
 * Derive the ct-monitor.ts firehose config from the single-source-of-truth
 * watchlist. `includeExpanded` (driven by FF_CT_MONITOR_EXPANDED) gates the
 * research-driven concentrated-target keywords: when false, only `tier:
 * 'core'` keywords are returned, reproducing the original hardcoded 9-keyword
 * behaviour exactly (no regression). The legitimate-domain exclusion set is
 * the union across every brand and is unaffected by the flag.
 */
export function getCtMonitorConfig(includeExpanded: boolean): CtMonitorConfig {
  const keywords: { keyword: string; brand: string }[] = [];
  const seen = new Set<string>();
  for (const entry of AU_BRAND_WATCHLIST) {
    if (!entry.ct) continue;
    if (entry.ct.tier === "expanded" && !includeExpanded) continue;
    if (seen.has(entry.ct.keyword)) continue;
    seen.add(entry.ct.keyword);
    keywords.push({ keyword: entry.ct.keyword, brand: entry.brand });
  }

  const domainSet = new Set<string>();
  for (const entry of AU_BRAND_WATCHLIST) {
    for (const d of entry.legitimate_domains) {
      domainSet.add(d.toLowerCase().replace(/\.$/, ""));
    }
  }

  return { keywords, legitimateDomains: [...domainSet] };
}
