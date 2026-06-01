-- v175 — curated long-form brand aliases  (branch: partner-data/brand-alias-layer)
--
-- WHY: v174 seeds brand_aliases from au-brand-watchlist.ts, which stores the
-- SHORT trading form clone-watch matches on ("NAB", "CBA", "ANZ"). But the
-- free-text brand strings that scam_reports / feed_items / reddit actually carry
-- are usually the official LONG form — "National Australia Bank", "Commonwealth
-- Bank". Post-v174, resolve_brand('National Australia Bank') returned NULL — the
-- exact "NAB" vs "National Australia Bank" miss v174's own header calls out. This
-- adds a small, hand-curated set of official long-forms + common expansions,
-- focused on the Big-4-bank pilot. source='manual' so a future watchlist re-seed
-- (which only writes source='watchlist' rows) never touches them.
--
-- Each canonical_brand below is byte-identical to an existing canonical in
-- brand_aliases so the resolved rows merge into the same group. alias_normalized
-- values are pre-computed to match brand_normalize() (lowercase, [a-z0-9] only).
--
-- Purely additive, idempotent. No schema change.
--
-- ON CONFLICT DO UPDATE (not DO NOTHING): curated rows are AUTHORITATIVE. v174's
-- directory auto-seed (step 4b) runs before this migration, so on a clean DB
-- rebuild a directory brand whose name normalizes to one of these keys (e.g. a
-- future PK "Commonwealth Bank" -> 'commonwealthbank') would otherwise claim the
-- key first and re-fragment the canonical. DO UPDATE lets the hand-curated
-- mapping win regardless of seed order. (No-op on the current prod state, where
-- none of these keys pre-existed.)
--
-- ROLLBACK: DELETE FROM public.brand_aliases WHERE source = 'manual';

INSERT INTO public.brand_aliases (alias_normalized, canonical_brand, source) VALUES
  ('commonwealthbank',                    'CBA',                          'manual'),
  ('commonwealthbankofaustralia',         'CBA',                          'manual'),
  ('nationalaustraliabank',               'NAB',                          'manual'),
  ('anzbank',                             'ANZ',                          'manual'),
  ('australiaandnewzealandbankinggroup',  'ANZ',                          'manual'),
  ('westpacbankingcorporation',           'Westpac',                      'manual'),
  ('ato',                                 'Australian Taxation Office',   'manual'),
  ('homeaffairs',                         'Department of Home Affairs',   'manual')
ON CONFLICT (alias_normalized) DO UPDATE
  SET canonical_brand = EXCLUDED.canonical_brand,
      source          = 'manual';
