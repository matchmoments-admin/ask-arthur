-- Migration v84: add 'charity' to the feed_ingestion_log.record_type CHECK.
--
-- Why: pipeline/scrapers/acnc_register.py (introduced in v83) calls
-- log_ingestion(..., record_type='charity') after a successful upsert,
-- but the existing CHECK constraint on feed_ingestion_log only allowed
-- 'url' | 'ip' | 'crypto_wallet' | 'entity'. The first prod scrape
-- run (#25245405447, 2026-05-02) succeeded at the data-ingest layer
-- (63,637 rows landed cleanly in acnc_charities) but threw
-- psycopg2.errors.CheckViolation on the post-ingest log_ingestion
-- INSERT. The Slack failure notification fired even though the
-- charity table is fully populated.
--
-- This migration adds 'charity' to the allowlist so future scrapes
-- log cleanly. Idempotent — uses DROP CONSTRAINT IF EXISTS + ADD.

ALTER TABLE feed_ingestion_log
  DROP CONSTRAINT IF EXISTS feed_ingestion_log_record_type_check;

ALTER TABLE feed_ingestion_log
  ADD CONSTRAINT feed_ingestion_log_record_type_check
  CHECK (record_type = ANY (ARRAY['url'::text, 'ip'::text, 'crypto_wallet'::text, 'entity'::text, 'charity'::text]));
