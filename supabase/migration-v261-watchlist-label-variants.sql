-- v261 — bridge plain trading names to their SUFFIXED watchlist labels
--
-- WHY
-- ---
-- The clone-watch "already watched?" gate (buildWatchedKeySet) is EXACT set
-- membership on brand_normalize(). A watchlist entry labelled 'eBay Australia'
-- normalises to `ebayaustralia`; the upstream classifier only ever emits the
-- plain trading name, `ebay`. They never match — so a brand we already monitor
-- is proposed to the operator as a brand-new candidate.
--
-- This is v260's bug class again, but STRUCTURAL rather than incidental: it is
-- not one odd label, it is every watchlist entry whose label carries a
-- disambiguating suffix. Audited across all 291 entries on 2026-07-30, 16 have
-- an unwatched plain form; 12 are fixed here (exclusions below).
--
-- Live consequence at the time of writing: `eBay` sat at the TOP of
-- /admin/brand-candidates with AU evidence, looking like the obvious brand to
-- promote — while already being monitored as 'eBay Australia'. Promoting it
-- would have created a second, overlapping entry for a brand already covered.
--
-- WHY THIS SEAM AND NOT THE WATCHLIST `aliases` FIELD
-- ---------------------------------------------------
-- The tempting fix is `aliases: ["eBay"]` on the entry, because
-- buildWatchedKeySet reads aliases. It is wrong here, for the reason that
-- field's own doc comment gives (au-brand-watchlist.ts): "Keep aliases >=5
-- chars and distinctive — a generic alias reintroduces the dictionary-word FP
-- class the scam-context gate exists to suppress."
--
-- `aliases` are LIVE MATCHER TOKENS — getWatchlistIndex (lexical-match.ts)
-- pushes each into the NRD lexical match. Five of the twelve plain forms are
-- under 5 chars (ebay, kayo, myki, opal, ing). Short tokens are mostly guarded
-- (no Levenshtein, substring needs an exact hyphen-segment match plus scam
-- context) BUT the confusable path has no length guard, so `ing` would match
-- any confusable-bearing domain containing "ing" at score 0.9. That is a live
-- matcher behaviour change smuggled into a queue-hygiene fix, against a
-- 30-70 hits/day baseline that would then need re-measuring.
--
-- brand_aliases is not read by the matcher at all (only lexical-match.ts and
-- active-watchlist.ts read `.aliases`; neither reads this table), and CONTEXT.md
-- already defines this table as the seam that collapses
-- "NAB"/"nab"/"National Australia Bank" to one identity — precisely this
-- problem. Zero matcher risk, no new vocabulary.
--
-- UPSERT, NOT `ON CONFLICT DO NOTHING` — READ THIS BEFORE EDITING
-- ---------------------------------------------------------------
-- Three of these keys ALREADY have rows, and they are SELF-REFERENTIAL:
--   ebay    -> 'eBay'      (source='directory', seeded from known_brands by v195)
--   netflix -> 'Netflix'
--   binance -> 'Binance'
-- Each normalises straight back to the unwatched key, so it bridges nothing.
-- A DO-NOTHING migration would silently no-op on exactly the row that is live
-- in the queue today (`ebay`) and look like it had worked. Hence DO UPDATE.
--
-- SIDE EFFECTS — checked, not assumed
-- Shifting the canonical for `ebay` from 'eBay' to 'eBay Australia' is safe for
-- the other consumer of this table: matchKnownBrand (report-brand-stewardship.ts)
-- resolves BOTH sides through the resolver before comparing, so the match stays
-- symmetric. known_brands holds both 'eBay' and 'eBay Australia' rows with the
-- same brand_domain (ebay.com.au), so auto-promotion's domain lookup is
-- unaffected whichever label wins.
--
-- DELIBERATELY EXCLUDED (do not "complete" this list without thinking)
--   virgin  — AMBIGUOUS. Both 'Virgin Australia' and 'Virgin Money' are on the
--             watchlist. An operator decision, not a mechanical one.
--   bank, ip, services, reservebankof — generic words or malformed stems from
--             'Bank Australia', 'IP Australia', 'Services Australia',
--             'Reserve Bank of Australia'. Aliasing a generic word collapses
--             unrelated mentions onto a watched brand. ('RBA' would be the
--             right alias for the last one — a separate judgement.)
--
-- SCOPE: purely additive/corrective reference data. No table altered, no write
-- path touched, not a hot table (318 rows). Re-applying is safe and idempotent.
--
-- ROLLBACK (restores the three v195-seeded self-referential rows; the other
-- nine were not present before this migration):
--   UPDATE public.brand_aliases SET canonical_brand='eBay',    source='directory' WHERE alias_normalized='ebay';
--   UPDATE public.brand_aliases SET canonical_brand='Netflix', source='directory' WHERE alias_normalized='netflix';
--   UPDATE public.brand_aliases SET canonical_brand='Binance', source='directory' WHERE alias_normalized='binance';
--   DELETE FROM public.brand_aliases WHERE source='watchlist' AND alias_normalized IN
--     ('spotify','disney','foxtel','kayo','ing','linkt','opal','translink','myki');

INSERT INTO public.brand_aliases (alias_normalized, canonical_brand, source) VALUES
  -- Already had a self-referential row -> these three are UPDATEs, not inserts.
  ('ebay',      'eBay Australia',                   'watchlist'),
  ('netflix',   'Netflix (AU)',                     'watchlist'),
  ('binance',   'Binance Australia',                'watchlist'),
  -- New.
  ('spotify',   'Spotify (AU)',                     'watchlist'),
  ('disney',    'Disney+ (AU)',                     'watchlist'),
  ('foxtel',    'Foxtel / Kayo',                    'watchlist'),
  ('kayo',      'Foxtel / Kayo',                    'watchlist'),
  ('ing',       'ING Australia',                    'watchlist'),
  ('linkt',     'Linkt (Transurban)',               'watchlist'),
  ('opal',      'Opal (Transport for NSW)',         'watchlist'),
  ('translink', 'Translink (Queensland)',           'watchlist'),
  ('myki',      'myki (Public Transport Victoria)', 'watchlist')
ON CONFLICT (alias_normalized) DO UPDATE
  SET canonical_brand = EXCLUDED.canonical_brand,
      source          = EXCLUDED.source;

-- Verification — every canonical_brand here MUST normalise to a key that
-- buildWatchedKeySet(AU_BRAND_WATCHLIST) already contains, or the bridge does
-- not actually reach the watchlist:
--   SELECT alias_normalized, canonical_brand,
--          public.brand_normalize(canonical_brand) AS watchlist_key
--   FROM public.brand_aliases
--   WHERE alias_normalized IN ('ebay','netflix','binance','spotify','disney','foxtel',
--     'kayo','ing','linkt','opal','translink','myki')
--   ORDER BY 1;
-- `ebay` must read 'eBay Australia'. If it still reads 'eBay', the DO UPDATE
-- was dropped and this migration achieved nothing.
