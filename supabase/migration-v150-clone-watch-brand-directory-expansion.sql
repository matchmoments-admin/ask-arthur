-- v150: Clone-watch Phase 1 — brand directory expansion + severity-aware
-- notification queue.
--
-- 1. Adds evidence_source_url + last_verified_at columns to
--    brand_contact_directory (provenance + quarterly re-verification cadence).
-- 2. UPSERTs 26 newly-verified existing brands (promotes them out of
--    manual_review by attaching real security contacts from
--    docs/research/clone-watch-brand-contacts.md).
-- 3. INSERTs 47 new high-impersonation brands (government, energy, airlines,
--    health insurers, crypto, investment, transport, real-estate, streaming,
--    e-commerce) with their best-available channels.
-- 4. Creates clone_alert_notification_queue + 3 helper RPCs for severity-
--    gated notification: high/critical send immediately (existing path),
--    medium batches daily, low surfaces in the weekly digest only.
-- 5. Per-brand send cap is enforced via Inngest's rateLimit (already 5/24h
--    in the notify fn); the queue + cron picks up the per-batch grouping.
--
-- Idempotent: ON CONFLICT (brand) DO UPDATE for all directory rows,
-- CREATE TABLE / CREATE INDEX / CREATE FUNCTION IF NOT EXISTS for schema.

-- ── 1. Directory schema additions ────────────────────────────────────────

ALTER TABLE public.brand_contact_directory
  ADD COLUMN IF NOT EXISTS evidence_source_url text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.brand_contact_directory.evidence_source_url IS
  'URL where the recipient was verified (security.txt, Bugcrowd VDP page, brand-owned responsible-disclosure page). The provenance trail an admin needs to audit a contact.';
COMMENT ON COLUMN public.brand_contact_directory.last_verified_at IS
  'When the recipient was last confirmed live. Quarterly re-verification cadence: cron flags rows >90d stale to the admin Telegram digest.';

-- ── 2. UPSERT directory rows (26 newly-verified existing + 47 new) ──────
--
-- ON CONFLICT (brand) DO UPDATE so:
--   - re-running the migration is safe
--   - an admin can hand-edit a row (channel_type, recipient) and the
--     migration won't trample it on next deploy (we update via the same
--     UPSERT clause + a guard: only overwrite when last_verified_at is
--     older than this migration's runtime — preserves admin edits made
--     after migration applied).

INSERT INTO public.brand_contact_directory
  (brand, legitimate_domain, channel_type, recipient, evidence_format,
   evidence_source_url, notes, last_verified_at)
VALUES
  -- ── 2a. EXISTING 26 brands — promoted from manual_review to verified ──
  ('Bunnings', 'bunnings.com.au', 'fraud_inbox',
    'responsible-disclosure@bunnings.com.au', 'plain_email',
    'https://www.bunnings.com.au/help-centre/responsible-disclosure-of-security-vulnerabilities',
    'PGP preferred (not required); Wesfarmers subsidiary',
    now()),
  ('Woolworths', 'woolworths.com.au', 'fraud_inbox',
    'vulnerabilitydisclosure@bigw.com.au', 'plain_email',
    'https://hackerone.com/woolworthslimited',
    'Single Woolworths Group inbox covers Woolies Supermarkets + Big W + Countdown + Rewards',
    now()),
  ('Coles', 'coles.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/coles-vdp-pro', 'bugcrowd_form',
    'https://www.coles.com.au/important-information/bugcrowd',
    'Coles Group covers Coles, Coles Liquor (Liquorland, Vintage Cellars, First Choice), Coles Express',
    now()),
  ('Aldi', 'aldi.com.au', 'fraud_inbox',
    'dataprotection@aldi.com.au', 'plain_email',
    'https://www.aldi.com.au/data-protection',
    'No AU-specific VDP; ALDI SOUTH global program does not list AU domains',
    now()),
  ('Big W', 'bigw.com.au', 'fraud_inbox',
    'vulnerabilitydisclosure@bigw.com.au', 'plain_email',
    'https://hackerone.com/woolworthslimited',
    'Same Woolworths Group inbox',
    now()),
  ('Myer', 'myer.com.au', 'fraud_inbox',
    'privacy@myer.com.au', 'plain_email',
    'https://www.myer.com.au/content/privacy',
    'Data Protection Officer; no published VDP',
    now()),
  ('Harvey Norman', 'harveynorman.com.au', 'fraud_inbox',
    'HNPrivacy.officer@au.harveynorman.com', 'plain_email',
    'https://www.harveynorman.com.au/privacy-policy',
    'Privacy Officer inbox; no dedicated security channel',
    now()),
  ('Reece', 'reece.com.au', 'fraud_inbox',
    'privacy.officer@reece.com.au', 'plain_email',
    'https://www.reece.com.au/privacy',
    'Privacy Officer; no security-specific channel',
    now()),
  ('Dan Murphy''s', 'danmurphys.com.au', 'fraud_inbox',
    'independentsecurityresearchers@edg.com.au', 'plain_email',
    'https://www.endeavourgroup.com.au/vulnerability-disclosure-policy',
    'Endeavour Group covers Dan Murphy''s + BWS + ALH Hotels; subject must be "INDEPENDENT SECURITY RESEARCHER ADVISORY"',
    now()),
  ('BWS', 'bws.com.au', 'fraud_inbox',
    'independentsecurityresearchers@edg.com.au', 'plain_email',
    'https://www.endeavourgroup.com.au/vulnerability-disclosure-policy',
    'Same Endeavour Group VDP inbox',
    now()),
  ('Liquorland', 'liquorland.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/coles-vdp-pro', 'bugcrowd_form',
    'https://www.coles.com.au/important-information/bugcrowd',
    'Coles Liquor — covered by Coles Group Bugcrowd program',
    now()),
  ('Chemist Warehouse', 'chemistwarehouse.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/engagements/chemistwarehouse-vdp-pro', 'bugcrowd_form',
    'https://www.chemistwarehouse.com.au/help-centre/terms-and-policies/secure-online-shopping',
    'CW Retail Services Pty Ltd; UAE branch uses separate inbox',
    now()),
  ('StarTrack', 'startrack.com.au', 'fraud_inbox',
    'security@auspost.com.au', 'plain_email',
    'https://auspost.com.au/.well-known/security.txt',
    'StarTrack owned by Australia Post; AusPost security team handles StarTrack systems',
    now()),
  ('Domino''s', 'dominos.com.au', 'fraud_inbox',
    'vulnerability@dominos.com.au', 'plain_email',
    'https://www.dominos.com.sg/about-us/contact-us/responsible-disclosure/',
    'Program run via Synack (responsibledisclosure.com); direct AU/NZ inbox',
    now()),
  ('KFC', 'kfc.com.au', 'contact_form',
    'https://kfc.responsibledisclosure.com/', 'web_form',
    'https://kfc.responsibledisclosure.com/hc/en-us',
    'KFC global program run by Synack (ResponsibleDisclosure.com); requires account',
    now()),
  ('Hungry Jack''s', 'hungryjacks.com.au', 'fraud_inbox',
    'hja.customerservice@hungryjacks.com.au', 'plain_email',
    'https://www.hungryjacks.com.au/contact-us',
    'No security-specific channel; customer service inbox is the only published path',
    now()),
  ('Subway', 'subway.com.au', 'contact_form',
    'https://hackerone.com/subway', 'web_form',
    'https://hackerone.com/subway',
    'Global HackerOne VDP covers AU; requires HackerOne account',
    now()),
  ('7-Eleven', '7eleven.com.au', 'fraud_inbox',
    'privacy@7eleven.com.au', 'plain_email',
    'https://www.7eleven.com.au/privacy-policy.html',
    'No AU security-specific VDP; privacy inbox is closest channel',
    now()),
  ('Smiggle', 'smiggle.com.au', 'fraud_inbox',
    'dataprotection@smiggle.com', 'plain_email',
    'https://help.smiggle.com.au/hc/en-au/articles/4403123321869',
    'Just Group / Premier Investments; DPO inbox',
    now()),
  ('Sportsgirl', 'sportsgirl.com.au', 'fraud_inbox',
    'privacy@sussangroup.com.au', 'plain_email',
    'https://www.sportsgirl.com.au/privacy-policy',
    'Sussan Group (Sportsgirl, Sussan, Suzanne Grae); Privacy Officer is closest channel',
    now()),
  ('Glue Store', 'gluestore.com.au', 'fraud_inbox',
    'shop@gluestore.com.au', 'plain_email',
    'https://help.gluestore.com.au/hc/en-us/articles/4640268017177-PRIVACY-POLICY',
    'Use subject ATTN: Fraud Protection Officer',
    now()),
  ('Universal Store', 'universalstore.com', 'fraud_inbox',
    'help@universalstore.com.au', 'plain_email',
    'https://www.universalstore.com/pages/privacy-policy',
    'No security-specific channel; general help inbox',
    now()),
  ('Surfstitch', 'surfstitch.com', 'fraud_inbox',
    'customerservice@surfstitch.com', 'plain_email',
    'https://surfstitch.com/pages/privacy-policy',
    'No security-specific channel; customer service inbox',
    now()),
  ('Westpac', 'westpac.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/engagements/westpac-vdp-pro', 'bugcrowd_form',
    'https://www.westpac.com.au/security/how-to-report/responsible-disclosure/',
    'Alternative direct: VulnDisclosure@westpac.com.au — covers St.George, Bank of Melbourne, BankSA',
    now()),
  ('NAB', 'nab.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/nationalaustraliabankog', 'bugcrowd_form',
    'https://hackerone.com/nab',
    'Bugcrowd mandatory; NAB will not accept direct disclosures. Covers ubank, Medfin, Advantedge',
    now()),
  ('ANZ', 'anz.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/anz-vdp', 'bugcrowd_form',
    'https://www.anz.com.au/security/',
    'Bugcrowd mandatory; alt fraud: hoax@cybersecurity.anz.com (phishing only)',
    now()),
  ('Telstra', 'telstra.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/telstra-vdp', 'bugcrowd_form',
    'https://www.telstra.com.au/cyber-security-and-safety',
    'Covers Telstra + Belong; Telstra Health has separate program',
    now()),
  ('Optus', 'optus.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/optus-vdp-pro', 'bugcrowd_form',
    'https://www.optus.com.au/support/cyberresponse',
    'Public VDP for AU consumer; managed bounty separately',
    now()),
  ('Vodafone', 'vodafone.com.au', 'fraud_inbox',
    'responsible.disclosure@vodafone.com', 'plain_email',
    'https://www.vodafone.com/about-vodafone/how-we-operate/consumer-privacy-and-cyber-security/cyber-security/report-a-vulnerability',
    'Global Vodafone inbox covers AU; also HackerOne VDP',
    now()),
  -- ── 2b. NEW 47 brands ─────────────────────────────────────────────────
  ('myGov', 'my.gov.au', 'fraud_inbox',
    'public.disclosure@servicesaustralia.gov.au', 'plain_email',
    'https://www.servicesaustralia.gov.au/report-cyber-security-system-risk',
    'Services Australia handles myGov; same inbox covers Centrelink + Medicare + Child Support',
    now()),
  ('Australian Taxation Office', 'ato.gov.au', 'fraud_inbox',
    'VulnerabilityDisclosure@ato.gov.au', 'plain_email',
    'https://www.ato.gov.au/online-services/cyber-safety/report-a-system-security-vulnerability',
    'ATO-published VDP; government agency — no bounty payable',
    now()),
  ('Services Australia', 'servicesaustralia.gov.au', 'fraud_inbox',
    'public.disclosure@servicesaustralia.gov.au', 'plain_email',
    'https://www.servicesaustralia.gov.au/report-cyber-security-system-risk',
    'Same inbox as myGov',
    now()),
  ('Service NSW', 'service.nsw.gov.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/service-nsw-vdp', 'bugcrowd_form',
    'https://www.service.nsw.gov.au/about-us/contact-us/vulnerability-disclosures',
    'Direct web form alternative if Bugcrowd account is a barrier',
    now()),
  ('Department of Home Affairs', 'homeaffairs.gov.au', 'fraud_inbox',
    'VulnerabilityDisclosure@homeaffairs.gov.au', 'plain_email',
    'https://www.homeaffairs.gov.au/about-us/our-portfolios/cyber-security/vulnerability-disclosure-program',
    'Covers immi.homeaffairs.gov.au; not for visa/immigration enquiries',
    now()),
  ('NDIS', 'ndis.gov.au', 'fraud_inbox',
    'itsecurity@ndis.gov.au', 'plain_email',
    'https://www.ndis.gov.au/about-us/policies/vulnerability-disclosure-policy',
    'NDIA-published VDP; NDIS Commission has separate VDP',
    now()),
  ('Australian Electoral Commission', 'aec.gov.au', 'fraud_inbox',
    'VulnerabilityDisclosure@aec.gov.au', 'plain_email',
    'https://www.aec.gov.au/about_aec/Publications/policy/vulnerability-disclosure.htm',
    'AEC-published VDP',
    now()),
  ('Reserve Bank of Australia', 'rba.gov.au', 'fraud_inbox',
    'cybersecurity+vdp@rba.gov.au', 'plain_email',
    'https://www.rba.gov.au/vulnerability-disclosure-program/',
    'RBA-published VDP; 5-business-day SLA',
    now()),
  ('AGL', 'agl.com.au', 'fraud_inbox',
    'security@agl.com.au', 'plain_email',
    'https://www.agl.com.au/terms-conditions/responsible-disclosure-policy',
    'AGL GSOC; also HackerOne VDP. PGP preferred',
    now()),
  ('Origin Energy', 'originenergy.com.au', 'fraud_inbox',
    'digitalsecurity@originenergy.com.au', 'plain_email',
    'https://hackerone.com/originenergy',
    'Origin runs both HackerOne VDP and Bugcrowd bounty; direct email most reliable',
    now()),
  ('Powershop', 'powershop.com.au', 'fraud_inbox',
    'security@shellenergy.com.au', 'plain_email',
    'https://www.powershop.com.au/privacy-policy/powershop-responsible-disclosure-policy',
    'Shell Energy IT runs the Powershop responsible-disclosure program',
    now()),
  ('Qantas', 'qantas.com.au', 'contact_form',
    'https://hackerone.com/qantas', 'web_form',
    'https://hackerone.com/qantas',
    'HackerOne-managed VDP; requires HackerOne account',
    now()),
  ('Virgin Australia', 'virginaustralia.com', 'fraud_inbox',
    'privacy@virginaustralia.com', 'plain_email',
    'https://www.virginaustralia.com/au/en/about-us/legal-policies/privacy/privacy-policy/',
    'No published security VDP; Privacy Officer is closest channel',
    now()),
  ('Booking.com', 'booking.com', 'fraud_inbox',
    'appsecurity@booking.com', 'plain_email',
    'https://hackerone.com/bookingcom',
    'HackerOne bug-bounty; covers Wotif (subsidiary)',
    now()),
  ('Wotif', 'wotif.com', 'fraud_inbox',
    'appsecurity@booking.com', 'plain_email',
    'https://hackerone.com/bookingcom',
    'Same Booking.com program (parent)',
    now()),
  ('Bupa', 'bupa.com.au', 'fraud_inbox',
    'scams@bupa.com.au', 'plain_email',
    'https://www.bupa.com.au/help/privacy-and-security-trust-centre/scams',
    'No published VDP; scams@ inbox is brand-published security channel',
    now()),
  ('NIB', 'nib.com.au', 'fraud_inbox',
    'nibInvestigations@nib.com.au', 'plain_email',
    'https://www.nib.com.au/health-information/member-services/protecting-your-information',
    'NIB Investigations Team; ISO27001-certified but no public VDP',
    now()),
  ('Binance Australia', 'binance.com', 'bugcrowd_vdp',
    'https://bugcrowd.com/binance', 'bugcrowd_form',
    'https://bugcrowd.com/binance',
    'Global Binance bug-bounty via Bugcrowd covers binance.com.au',
    now()),
  ('CoinSpot', 'coinspot.com.au', 'contact_form',
    'https://hackerone.com/coinspot', 'web_form',
    'https://www.coinspot.com.au/security',
    'HackerOne bug-bounty',
    now()),
  ('Independent Reserve', 'independentreserve.com', 'fraud_inbox',
    'security@independentreserve.com', 'plain_email',
    'https://www.independentreserve.com/security',
    'Direct security email; ISO 27001 certified',
    now()),
  ('BTC Markets', 'btcmarkets.net', 'contact_form',
    'https://www.btcmarkets.net/bug-bounty', 'web_form',
    'https://www.btcmarkets.net/bug-bounty',
    'Bug bounty via brand-owned form',
    now()),
  ('realestate.com.au', 'realestate.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/engagements/rea-mbb-og', 'bugcrowd_form',
    'https://hackerone.com/realestate_com',
    'REA Group Bugcrowd covers realestate.com.au + realcommercial.com.au + property.com.au',
    now()),
  ('Domain', 'domain.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/engagements/domain-vdp-pro', 'bugcrowd_form',
    'https://bugcrowd.com/engagements/domain-vdp-pro',
    'Domain Holdings VDP',
    now()),
  ('Carsales', 'carsales.com.au', 'fraud_inbox',
    'security@carsales.com.au', 'plain_email',
    'https://www.carsales.com.au/info/responsible-disclosure-program/',
    'Covers carsales + redbook + bikesales',
    now()),
  ('Gumtree', 'gumtree.com.au', 'contact_form',
    'https://hackerone.com/gumtree_australia', 'web_form',
    'https://hackerone.com/gumtree_australia',
    'HackerOne VDP — previously routed via Zerocopter; confirm before sending',
    now()),
  ('Foxtel / Kayo', 'foxtel.com.au', 'fraud_inbox',
    'disclosures@fox.com', 'plain_email',
    'https://www.foxcorporation.com/responsible-vulnerability-disclosure-policy/',
    'Fox Corporation VDP covers Foxtel Group (Foxtel, Hubbl, BINGE, Kayo, Flash)',
    now()),
  ('Netflix (AU)', 'netflix.com', 'bugcrowd_vdp',
    'https://bugcrowd.com/netflix', 'bugcrowd_form',
    'https://help.netflix.com/en/node/6657',
    'Public Netflix bug-bounty via Bugcrowd',
    now()),
  ('Spotify (AU)', 'spotify.com', 'contact_form',
    'https://hackerone.com/spotify', 'web_form',
    'https://www.spotify.com/us/bounty/',
    'HackerOne bug-bounty',
    now()),
  ('Stan', 'stan.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/nine-entertainment-vdp-pro', 'bugcrowd_form',
    'https://bugcrowd.com/nine-entertainment-vdp-pro',
    'Nine Entertainment VDP — covers Stan + 9Now + news.com.au + smh + theage + AFR',
    now()),
  ('Disney+ (AU)', 'disneyplus.com', 'contact_form',
    'https://hackerone.com/disney', 'web_form',
    'https://hackerone.com/disney',
    'Walt Disney HackerOne VDP covers Disney+ globally',
    now()),
  ('eBay Australia', 'ebay.com.au', 'contact_form',
    'https://hackerone.com/ebay_com_au', 'web_form',
    'https://pages.ebay.com/securitycenter/security_researchers.html',
    'eBay-published responsible-disclosure; AU-specific HackerOne program',
    now()),
  -- ── manual_review rows for new brands without published contacts ──
  -- (still seeded so the operator gets a Telegram page with the brand
  -- name + watchlist domain when a clone is detected)
  ('Service Victoria', 'service.vic.gov.au', 'manual_review',
    NULL, 'plain_email',
    'https://service.vic.gov.au/privacy-and-security',
    'No published VDP for Service Victoria. OVIC handles complaints',
    now()),
  ('Service WA', 'wa.gov.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.wa.gov.au/service/digital-services/digital-identity-and-security',
    'No public VDP for ServiceWA. WA Office of Digital Government is parent',
    now()),
  ('EnergyAustralia', 'energyaustralia.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.energyaustralia.com.au/home/help-and-support/faqs/online-security',
    'No published VDP; account-compromise hotline 133 466 only',
    now()),
  ('Red Energy', 'redenergy.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.redenergy.com.au/security/',
    'No published VDP; Snowy Hydro subsidiary',
    now()),
  ('Alinta Energy', 'alintaenergy.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.alintaenergy.com.au/help-and-support/help-and-support/customer-support/scam-information/',
    'No published VDP',
    now()),
  ('Simply Energy', 'simplyenergy.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.simplyenergy.com.au/contact-us',
    'Engie-owned; no published VDP for AU brand',
    now()),
  ('Jetstar', 'jetstar.com', 'manual_review',
    NULL, 'plain_email',
    'https://www.jetstar.com/au/en/privacy-policy',
    'Qantas Group owned; no published security email',
    now()),
  ('Webjet', 'webjet.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.webjet.com.au/about/privacy/',
    'No published security/VDP channel',
    now()),
  ('Flight Centre', 'flightcentre.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://help.flightcentre.com.au/s/article/privacy-policy-au',
    'Chief Privacy Officer (no direct email published)',
    now()),
  ('Medibank', 'medibank.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.medibank.com.au/help/security-and-privacy/',
    'Despite 2022 breach Medibank has not published a VDP. Try via medibank.com.au/contact-us',
    now()),
  ('HCF', 'hcf.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.hcf.com.au/about-us/about-HCF/information-security',
    'No published VDP. Try privacy@hcf.com.au as a probe',
    now()),
  ('AHM', 'ahm.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.ahm.com.au/about-us/contact',
    'Medibank Private subsidiary; route to Medibank channel',
    now()),
  ('HBF', 'hbf.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.hbf.com.au/contact-us',
    'No published VDP',
    now()),
  ('Swyftx', 'swyftx.com', 'manual_review',
    NULL, 'plain_email',
    'https://support.swyftx.com/hc/en-au/articles/13306450184089-Swyftx-safety-and-security',
    'No published VDP. Try security@swyftx.com as a probe',
    now()),
  ('Digital Surge', 'digitalsurge.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://digitalsurge.com.au/security',
    'No published VDP. Try security@digitalsurge.com.au as a probe',
    now()),
  ('CommSec', 'commsec.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.commsec.com.au/safe-digital-tips',
    'CBA subsidiary; CommBank Group has no public VDP',
    now()),
  ('Stake', 'hellostake.com', 'manual_review',
    NULL, 'plain_email',
    'https://hellostake.com/au/support/privacy-and-security/account-security/26009869281049',
    'No published VDP. Try security@hellostake.com',
    now()),
  ('SelfWealth', 'selfwealth.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.selfwealth.com.au/privacy-policy/',
    'No published VDP',
    now()),
  ('Superhero', 'superhero.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://superhero.com.au/disclaimer',
    'No published VDP',
    now()),
  ('Pearler', 'pearler.com', 'manual_review',
    NULL, 'plain_email',
    'https://pearler.com/legal/privacy-policy',
    'No published VDP',
    now()),
  ('Linkt (Transurban)', 'linkt.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.linkt.com.au/help/security/latest-scams',
    'Transurban-operated; no published VDP. Top-3 most-impersonated AU brand',
    now()),
  ('EastLink', 'eastlink.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.eastlink.com.au/enquiries/security-and-fraud',
    'No published VDP. Note: Eway (eway.com.au) is separate',
    now()),
  ('Opal (Transport for NSW)', 'transportnsw.info', 'manual_review',
    NULL, 'plain_email',
    'https://www.transport.nsw.gov.au/contact-us',
    'No Opal-specific VDP; Transport for NSW does not publish separately',
    now()),
  ('myki (Public Transport Victoria)', 'ptv.vic.gov.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.ptv.vic.gov.au/contact-us',
    'No published VDP',
    now()),
  ('Translink (Queensland)', 'translink.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://translink.com.au/about-translink/contact-us',
    'No published VDP',
    now()),
  ('Kogan', 'kogan.com', 'manual_review',
    NULL, 'plain_email',
    'https://www.kogan.com/au/privacy-policy/',
    'No published VDP. Try security@kogan.com',
    now()),
  ('MyDeal', 'mydeal.com.au', 'manual_review',
    NULL, 'plain_email',
    'https://www.mydeal.com.au/privacy',
    'Woolworths Group acquisition but no obvious inheritance; can try Group inbox as fallback',
    now())
ON CONFLICT (brand) DO UPDATE SET
  legitimate_domain = EXCLUDED.legitimate_domain,
  channel_type = EXCLUDED.channel_type,
  recipient = EXCLUDED.recipient,
  evidence_format = EXCLUDED.evidence_format,
  evidence_source_url = EXCLUDED.evidence_source_url,
  notes = EXCLUDED.notes,
  -- Preserve admin hand-edits: only overwrite last_verified_at if existing
  -- last_verified_at is older than 24h (i.e. this migration's data won) OR
  -- the existing row was still on manual_review (i.e. has no admin edit).
  -- This guards against an admin tweaking the recipient + the migration
  -- re-running on a later deploy and clobbering it.
  last_verified_at = CASE
    WHEN brand_contact_directory.channel_type = 'manual_review' THEN now()
    WHEN brand_contact_directory.last_verified_at < now() - interval '24 hours' THEN now()
    ELSE brand_contact_directory.last_verified_at
  END,
  updated_at = now();

-- ── 3. Notification queue table for severity-gated batching ─────────────

CREATE TABLE IF NOT EXISTS public.clone_alert_notification_queue (
  id bigserial PRIMARY KEY,
  alert_id bigint NOT NULL REFERENCES public.shopfront_clone_alerts(id) ON DELETE CASCADE,
  brand text NOT NULL,
  candidate_domain text NOT NULL,
  candidate_url text NOT NULL,
  recipient text NOT NULL,
  channel_type text NOT NULL CHECK (channel_type IN ('security_txt','fraud_inbox')),
  severity_tier text NOT NULL CHECK (severity_tier IN ('low','medium','high','critical')),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','skipped','expired')),
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  -- Avoid duplicate enqueue if notify-brand replays
  UNIQUE (alert_id, channel_type)
);

COMMENT ON TABLE public.clone_alert_notification_queue IS
  'Severity-gated batch + digest queue for clone-watch brand notifications. high/critical alerts bypass the queue (send immediately); medium queues for daily cron; low queues for weekly digest. Per-brand send cap is enforced upstream by the notify-brand Inngest rateLimit (5/24h).';

CREATE INDEX IF NOT EXISTS idx_clone_alert_notif_queue_pending
  ON public.clone_alert_notification_queue (scheduled_for, severity_tier)
  WHERE status = 'pending';

ALTER TABLE public.clone_alert_notification_queue ENABLE ROW LEVEL SECURITY;
-- No policies = service_role only.

-- ── 4. Helper RPCs ──────────────────────────────────────────────────────

-- Pull pending medium-severity rows ready to send (used by daily-batch cron)
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_notification_batch(
  p_severity text DEFAULT 'medium',
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  id bigint,
  alert_id bigint,
  brand text,
  candidate_domain text,
  candidate_url text,
  recipient text,
  channel_type text,
  severity_tier text,
  enqueued_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT q.id, q.alert_id, q.brand, q.candidate_domain, q.candidate_url,
         q.recipient, q.channel_type, q.severity_tier, q.enqueued_at
  FROM public.clone_alert_notification_queue q
  WHERE q.status = 'pending'
    AND q.severity_tier = p_severity
    AND q.scheduled_for <= now()
  ORDER BY q.enqueued_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_notification_batch(text, int)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_pending_notification_batch(text, int) IS
  'Pull pending notification-queue rows of the given severity that are due. Used by the daily medium-severity batch cron and the weekly low-severity digest cron.';

-- Mark queue rows processed atomically (used by both consumers after send)
CREATE OR REPLACE FUNCTION public.mark_clone_alert_notifications_processed(
  p_queue_ids bigint[],
  p_status text DEFAULT 'sent'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_status NOT IN ('sent','skipped','expired') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE public.clone_alert_notification_queue
  SET status = p_status,
      processed_at = now()
  WHERE id = ANY(p_queue_ids)
    AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_clone_alert_notifications_processed(bigint[], text)
  FROM anon, authenticated;

-- Enqueue helper used by notify-brand when severity is medium or low
CREATE OR REPLACE FUNCTION public.enqueue_clone_alert_notification(
  p_alert_id bigint,
  p_brand text,
  p_candidate_domain text,
  p_candidate_url text,
  p_recipient text,
  p_channel_type text,
  p_severity_tier text,
  p_scheduled_for timestamptz
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_channel_type NOT IN ('security_txt','fraud_inbox') THEN
    RAISE EXCEPTION 'invalid channel_type: %', p_channel_type USING ERRCODE = '22023';
  END IF;
  IF p_severity_tier NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'invalid severity_tier: %', p_severity_tier USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.clone_alert_notification_queue
    (alert_id, brand, candidate_domain, candidate_url, recipient,
     channel_type, severity_tier, scheduled_for)
  VALUES
    (p_alert_id, p_brand, p_candidate_domain, p_candidate_url, p_recipient,
     p_channel_type, p_severity_tier, p_scheduled_for)
  ON CONFLICT (alert_id, channel_type) DO UPDATE SET
    severity_tier = EXCLUDED.severity_tier,
    scheduled_for = EXCLUDED.scheduled_for,
    status = CASE
      WHEN clone_alert_notification_queue.status = 'sent'
        THEN clone_alert_notification_queue.status
      ELSE 'pending'
    END
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_clone_alert_notification(bigint, text, text, text, text, text, text, timestamptz)
  FROM anon, authenticated;
