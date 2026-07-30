-- v260 — close the label-variant leak in the "already watched?" gate
--
-- WHY
-- ---
-- reddit-brands-discover decides whether a brand is already covered by EXACT set
-- membership on brand_normalize() (buildWatchedKeySet + the v174 alias layer as a
-- second chance). But the upstream classifier emits FREE TEXT brand labels, and a
-- free-text label for a watched brand very often does not normalise to that
-- brand's watchlist key. When it doesn't, an already-watched brand surfaces as a
-- brand-new candidate for a human to triage.
--
-- Two of these are already live in production report data and are the two that
-- matter most, because both clear the AUTO-PROMOTION bar (scam >= 2) at a 90-day
-- window:
--
--   'Australian Tax Office (ATO)' -> australiantaxofficeato
--       watchlist key is australiantaxationoffice ('Australian Taxation Office')
--       -> NO match. Sitting at 1 report in the current 30d window, so it leaks
--          the moment a second ATO report lands, which for the single most
--          impersonated agency in Australia is a matter of when, not if.
--
--   'Google Australia' -> googleaustralia   (watchlist key: google) -> NO match
--
-- The existing alias layer already rescues the same shape for two others
-- ('ANZ Bank' -> ANZ, 'Commonwealth Bank' -> CBA, both source='manual'), which is
-- what makes this the right seam: the gate needs no new matching logic, the
-- variant just needs to be KNOWN. Measured 2026-07-30: resolved_canonical was
-- NULL on 50 of 51 candidate rows, i.e. the alias second-chance was resolving
-- almost nothing in practice.
--
-- FAILURE MODE THIS PREVENTS (why it is worth a migration rather than a shrug)
-- It fails safe today — known_brands holds no row keyed australiantaxofficeato,
-- so planPromotions() finds no domain and the brand lands in "needs a confirmed
-- domain" rather than being promoted. But that still puts brands we already watch
-- onto the operator's action list, which is exactly how the queue reached 51 rows
-- with zero ever actioned. And it is one seeded known_brands row away from
-- becoming a DUPLICATE monitored_brands entry, where a wrong legitimate_domain is
-- a permanent matcher blind spot rather than a missed alert.
--
-- 'Google Play' -> googleplay is included for a second, narrower reason: it is
-- currently the ONLY brand in the live 30d aggregate that is net-new, not
-- denylisted and not watched, so it alone was about to suppress the digest's
-- proof-of-life heartbeat. Collapsing it into Google is also just correct for
-- this feature's purpose — clone-watch matches lookalike DOMAINS, and Google Play
-- shares google.com's registrable domain, so the existing 'Google' entry already
-- covers any lookalike aimed at it.
--
-- SCOPE: purely additive reference data. No table altered, no write path touched,
-- not a hot table (311 rows). ON CONFLICT DO NOTHING keeps any existing mapping
-- authoritative and makes re-apply idempotent.
--
-- ROLLBACK (optional — these are harmless canonical mappings):
--   DELETE FROM public.brand_aliases
--   WHERE source = 'manual'
--     AND alias_normalized IN (
--       'australiantaxofficeato','googleaustralia','googleplay',
--       'instagrammeta','metafacebook','appleincicloud',
--       'mygovaustraliangovernment'
--     );

INSERT INTO public.brand_aliases (alias_normalized, canonical_brand, source) VALUES
  -- Live in report data, and both clear the auto-promotion bar at 90d.
  ('australiantaxofficeato',      'Australian Taxation Office', 'manual'),
  ('googleaustralia',             'Google',                     'manual'),
  -- The one net-new unwatched brand in the live 30d Reddit aggregate.
  ('googleplay',                  'Google',                     'manual'),
  -- Same shape, already present in the 180d report data at count 1 each. Seeded
  -- now so they never reach the digest; each canonical IS on the watchlist.
  ('instagrammeta',               'Instagram',                  'manual'),
  ('metafacebook',                'Facebook',                   'manual'),
  ('appleincicloud',              'Apple',                      'manual'),
  ('mygovaustraliangovernment',   'myGov',                      'manual')
ON CONFLICT (alias_normalized) DO NOTHING;

-- Verification (expect 7 rows, and every canonical_brand normalising to a key
-- that buildWatchedKeySet() already contains):
--   SELECT alias_normalized, canonical_brand,
--          public.brand_normalize(canonical_brand) AS canonical_key
--   FROM public.brand_aliases
--   WHERE alias_normalized IN (
--     'australiantaxofficeato','googleaustralia','googleplay',
--     'instagrammeta','metafacebook','appleincicloud','mygovaustraliangovernment'
--   )
--   ORDER BY alias_normalized;
