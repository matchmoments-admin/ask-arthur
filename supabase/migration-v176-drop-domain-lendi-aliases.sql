-- v176 — drop Domain + Lendi from the brand-alias layer
--
-- WHY: "Domain" (domain.com.au) and "Lendi" are removed from the clone-watch AU
-- brand watchlist (packages/shopfront-glue/src/au-brand-watchlist.ts) in the same
-- PR. "domain" is a generic dictionary word that produced too many lexical false
-- positives in the NRD sweep. Removing the watchlist entries stops future
-- matching; this removes their seeded canonical rows from brand_aliases so brand
-- resolution no longer maps free-text mentions to a brand we no longer track.
--
-- Only their own normalized-name rows exist (source='watchlist'): 'domain'->'Domain',
-- 'lendi'->'Lendi'. Idempotent.
--
-- ROLLBACK: re-add the entries to au-brand-watchlist.ts and re-run the seed
-- generator into a new migration (the v174 seed file still contains both rows,
-- so a full DB rebuild re-inserts them before this migration deletes them).

DELETE FROM public.brand_aliases WHERE canonical_brand IN ('Domain', 'Lendi');
