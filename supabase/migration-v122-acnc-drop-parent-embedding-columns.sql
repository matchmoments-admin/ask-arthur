-- v122: drop the now-redundant embedding columns from acnc_charities.
--
-- Follow-up to v121 which moved the embedding to the
-- `acnc_charity_embeddings` sibling table. Cutover verified end-to-end
-- before this migration:
--   * 63,637 rows backfilled into acnc_charity_embeddings (= source count)
--   * HNSW idx_acnc_charity_embeddings_hnsw built (497 MB)
--   * match_charities_by_embedding RPC rewritten to JOIN sibling
--   * acnc-charity-backfill-embed Inngest function writes to sibling
--   * No remaining code references acnc_charities.name_mission_embedding
--     or acnc_charities.embedding_model_version (grep across packages/,
--     apps/, pipeline/, supabase/ — 2026-05-11)
--
-- Postgres `DROP COLUMN` is metadata-only — it marks the column as deleted
-- in pg_attribute and adjusts the tuple-slot map. Existing tuples keep
-- their original layout; the disk space is reclaimed gradually by VACUUM
-- (or all at once on a future TABLE REWRITE). So this is safe to ship
-- even with the daily ACNC scraper UPDATEing the parent table — no row
-- rewrite, no index maintenance burst, no Disk-IO budget spike.
--
-- IDEMPOTENT: `IF EXISTS` makes re-applying a no-op.
--
-- ROLLBACK: re-add the column and restore data from the sibling via
--   ALTER TABLE acnc_charities ADD COLUMN name_mission_embedding VECTOR(1024);
--   UPDATE acnc_charities c SET name_mission_embedding = e.embedding
--     FROM acnc_charity_embeddings e WHERE c.abn = e.charity_abn;
-- (would need chunking — same pattern as the v121 data backfill.)

ALTER TABLE public.acnc_charities
  DROP COLUMN IF EXISTS name_mission_embedding,
  DROP COLUMN IF EXISTS embedding_model_version;
