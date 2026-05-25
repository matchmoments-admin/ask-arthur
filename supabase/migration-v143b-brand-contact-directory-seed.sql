-- v143b: Seed brand_contact_directory for the remaining ~46 AU watchlist brands
--
-- Default channel_type='manual_review' for every brand that doesn't have a
-- verified intake protocol. The clone-watch-notify-brand Inngest function
-- Telegram-pages the admin when channel_type='manual_review' instead of
-- auto-sending — operator looks up the brand's preferred contact, then
-- UPDATEs the row to channel_type='fraud_inbox' / 'security_txt' /
-- 'bugcrowd_vdp' with the verified recipient. No mail leaves until the
-- admin has done that lookup.
--
-- Idempotent: ON CONFLICT (brand) DO NOTHING so re-running the migration
-- doesn't trample admin-set verified rows.

INSERT INTO public.brand_contact_directory
  (brand, legitimate_domain, channel_type, recipient, evidence_format, notes)
VALUES
  -- Retail — big-box
  ('Bunnings', 'bunnings.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox. Wesfarmers-owned (same group as Kmart, Target, OfficeWorks).'),
  ('Woolworths', 'woolworths.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try security@woolworths.com.au; otherwise contact via Privacy Officer.'),
  ('Coles', 'coles.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try security@coles.com.au or via Coles Group privacy inbox.'),
  ('Aldi', 'aldi.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. AU branch reports to ALDI SOUTH Group; HQ in Germany.'),
  ('IGA', 'iga.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Metcash-owned wholesale brand.'),
  ('Big W', 'bigw.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Woolworths Group subsidiary.'),
  ('Myer', 'myer.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('David Jones', 'davidjones.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Anchorage Capital owned.'),
  -- Retail — electronics + hardware + homewares
  ('JB Hi-Fi', 'jbhifi.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('Harvey Norman', 'harveynorman.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('Officeworks', 'officeworks.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Wesfarmers-owned; Kmart Group Bugcrowd VDP may not cover this brand — confirm scope.'),
  ('Mitre 10', 'mitre10.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('Reece', 'reece.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  -- Retail — liquor + chemist
  ('Dan Murphy''s', 'danmurphys.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Endeavour Group owned (Woolworths demerger).'),
  ('BWS', 'bws.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Endeavour Group owned.'),
  ('Liquorland', 'liquorland.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Coles Group owned.'),
  ('Chemist Warehouse', 'chemistwarehouse.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('Priceline', 'priceline.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Wesfarmers-owned (acquired 2023).'),
  -- Logistics + post
  ('Toll', 'tollgroup.com', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Japan Post-owned.'),
  ('StarTrack', 'startrack.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Australia Post subsidiary — may route to security@auspost.com.au.'),
  ('Sendle', 'sendle.com', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try security@sendle.com or via support form.'),
  -- QSR
  ('Domino''s', 'dominos.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('McDonald''s', 'mcdonalds.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Routes to McDonald''s global security if local AU has no dedicated intake.'),
  ('KFC', 'kfc.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Collins Foods (ASX) operates AU franchises.'),
  ('Hungry Jack''s', 'hungryjacks.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('Subway', 'subway.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify.'),
  ('7-Eleven', '7eleven.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. 7-Eleven Stores Pty Ltd is independent AU operator.'),
  -- Fashion + apparel
  ('Smiggle', 'smiggle.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Premier Investments-owned.'),
  ('Cotton On', 'cottonon.com', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('Bonds', 'bonds.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Hanesbrands (US-owned).'),
  ('Country Road', 'countryroad.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Country Road Group, owned by Woolworths Holdings (ZA, not AU).'),
  ('Witchery', 'witchery.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Country Road Group sister brand.'),
  ('Sportsgirl', 'sportsgirl.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Sussan Group owned.'),
  ('Glue Store', 'gluestore.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Accent Group owned.'),
  ('Universal Store', 'universalstore.com', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('City Beach', 'citybeach.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  ('Surfstitch', 'surfstitch.com', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Crown Group owned (ASX-listed).'),
  ('Toyworld', 'toyworld.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify security/fraud inbox.'),
  -- Banks
  ('Westpac', 'westpac.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try abuse@westpac.com.au, phishing-report@westpac.com.au, or via banking ombudsman.'),
  ('NAB', 'nab.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try phishing@nab.com.au or via abuse@nab.com.au.'),
  ('ANZ', 'anz.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try hoax@cybersecurity.anz.com or abuse@anz.com.'),
  -- Telcos
  ('Telstra', 'telstra.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try misuse@telstra.com.au or abuse@telstra.com.au.'),
  ('Optus', 'optus.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try abuse@optus.com.au or security@optus.com.au.'),
  ('Vodafone', 'vodafone.com.au', 'manual_review', NULL, 'plain_email',
    'TODO: verify. Try abuse@vodafone.com.au; group security is run by VodafoneIdea (TPG/Vodafone JV in AU).')
ON CONFLICT (brand) DO NOTHING;
