-- Migration v118: archive shadows for 6 medium-volume tables (Phase 2.5)
--
-- Mirrors the v68 (scam_reports_archive) and v98 (feed_items_archive)
-- pattern. Six tables get LIKE-cloned archive shadows; a single RPC
-- moves rows older than per-table retention into the archive in
-- bounded 5k batches; an Inngest cron (separate file) drives nightly.
--
-- Tables + retention windows:
--   flagged_ads                 → 365d (last_flagged_at) — Facebook ad
--                                 scan results; flag-gated FF_FACEBOOK_ADS
--   deepfake_detections         → 365d (created_at) — Hive AI scan trail
--   media_analyses              → 180d (created_at) — audio/video
--                                 transcripts; PII-sensitive shorter window
--   scan_results                → 365d (scanned_at) — site-audit results
--                                 with public share tokens
--   verdict_feedback            → 730d (created_at) — forensic / model
--                                 training data
--   brand_impersonation_alerts  → 365d (created_at) — outreach CRM events
--
-- Pre-flight (2026-05-08):
--   flagged_ads:                 0 rows
--   deepfake_detections:         0 rows
--   media_analyses:              0 rows
--   scan_results:                2 rows
--   verdict_feedback:            4 rows
--   brand_impersonation_alerts:  8 rows
-- → Migration runs against essentially-empty tables; first archive run
--   moves 0 rows. Backfill happens organically as data ages.
--
-- LIKE INCLUDING DEFAULTS (no constraints / indexes / RLS) — archive
-- tables are intentionally lighter shape than parents. We don't
-- propagate FKs because parent rows might be deleted while archive rows
-- persist (audit-trail use).

-- ─── 1. flagged_ads ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flagged_ads_archive
  (LIKE public.flagged_ads INCLUDING DEFAULTS);
CREATE INDEX IF NOT EXISTS idx_flagged_ads_archive_last_flagged_brin
  ON public.flagged_ads_archive USING BRIN (last_flagged_at);
ALTER TABLE public.flagged_ads_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.flagged_ads_archive;
CREATE POLICY deny_all_anon_authenticated ON public.flagged_ads_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── 2. deepfake_detections ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deepfake_detections_archive
  (LIKE public.deepfake_detections INCLUDING DEFAULTS);
CREATE INDEX IF NOT EXISTS idx_deepfake_detections_archive_created_brin
  ON public.deepfake_detections_archive USING BRIN (created_at);
ALTER TABLE public.deepfake_detections_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.deepfake_detections_archive;
CREATE POLICY deny_all_anon_authenticated ON public.deepfake_detections_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── 3. media_analyses ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_analyses_archive
  (LIKE public.media_analyses INCLUDING DEFAULTS);
CREATE INDEX IF NOT EXISTS idx_media_analyses_archive_created_brin
  ON public.media_analyses_archive USING BRIN (created_at);
ALTER TABLE public.media_analyses_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.media_analyses_archive;
CREATE POLICY deny_all_anon_authenticated ON public.media_analyses_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── 4. scan_results ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scan_results_archive
  (LIKE public.scan_results INCLUDING DEFAULTS);
CREATE INDEX IF NOT EXISTS idx_scan_results_archive_scanned_brin
  ON public.scan_results_archive USING BRIN (scanned_at);
ALTER TABLE public.scan_results_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.scan_results_archive;
CREATE POLICY deny_all_anon_authenticated ON public.scan_results_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── 5. verdict_feedback ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.verdict_feedback_archive
  (LIKE public.verdict_feedback INCLUDING DEFAULTS);
CREATE INDEX IF NOT EXISTS idx_verdict_feedback_archive_created_brin
  ON public.verdict_feedback_archive USING BRIN (created_at);
ALTER TABLE public.verdict_feedback_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.verdict_feedback_archive;
CREATE POLICY deny_all_anon_authenticated ON public.verdict_feedback_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── 6. brand_impersonation_alerts ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_impersonation_alerts_archive
  (LIKE public.brand_impersonation_alerts INCLUDING DEFAULTS);
CREATE INDEX IF NOT EXISTS idx_brand_imp_alerts_archive_created_brin
  ON public.brand_impersonation_alerts_archive USING BRIN (created_at);
ALTER TABLE public.brand_impersonation_alerts_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.brand_impersonation_alerts_archive;
CREATE POLICY deny_all_anon_authenticated ON public.brand_impersonation_alerts_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── Unified archive RPC ────────────────────────────────────────────────
-- Returns one row per shadow with the count of rows moved. Bounded-batch
-- shape (5k per call) so each table run stays under 1s. The Inngest cron
-- wrapping this loops until 0 rows moved across all 6 tables (or hits
-- the 50-iteration safety cap).

CREATE OR REPLACE FUNCTION public.archive_secondary_tables_batch(
  p_batch_size INT DEFAULT 5000
) RETURNS TABLE (
  table_name TEXT,
  rows_moved INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_moved INT;
BEGIN
  -- flagged_ads (365d, by last_flagged_at)
  WITH src AS (
    DELETE FROM public.flagged_ads
    WHERE id IN (
      SELECT id FROM public.flagged_ads
      WHERE last_flagged_at < NOW() - INTERVAL '365 days'
      ORDER BY last_flagged_at
      LIMIT p_batch_size
    )
    RETURNING *
  )
  INSERT INTO public.flagged_ads_archive
  SELECT * FROM src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN QUERY SELECT 'flagged_ads'::TEXT, v_moved;

  -- deepfake_detections (365d, by created_at)
  WITH src AS (
    DELETE FROM public.deepfake_detections
    WHERE id IN (
      SELECT id FROM public.deepfake_detections
      WHERE created_at < NOW() - INTERVAL '365 days'
      ORDER BY created_at
      LIMIT p_batch_size
    )
    RETURNING *
  )
  INSERT INTO public.deepfake_detections_archive
  SELECT * FROM src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN QUERY SELECT 'deepfake_detections'::TEXT, v_moved;

  -- media_analyses (180d, by created_at — PII-sensitive shorter window)
  WITH src AS (
    DELETE FROM public.media_analyses
    WHERE id IN (
      SELECT id FROM public.media_analyses
      WHERE created_at < NOW() - INTERVAL '180 days'
      ORDER BY created_at
      LIMIT p_batch_size
    )
    RETURNING *
  )
  INSERT INTO public.media_analyses_archive
  SELECT * FROM src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN QUERY SELECT 'media_analyses'::TEXT, v_moved;

  -- scan_results (365d, by scanned_at)
  WITH src AS (
    DELETE FROM public.scan_results
    WHERE id IN (
      SELECT id FROM public.scan_results
      WHERE scanned_at < NOW() - INTERVAL '365 days'
      ORDER BY scanned_at
      LIMIT p_batch_size
    )
    RETURNING *
  )
  INSERT INTO public.scan_results_archive
  SELECT * FROM src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN QUERY SELECT 'scan_results'::TEXT, v_moved;

  -- verdict_feedback (730d, by created_at — forensic / model training)
  WITH src AS (
    DELETE FROM public.verdict_feedback
    WHERE id IN (
      SELECT id FROM public.verdict_feedback
      WHERE created_at < NOW() - INTERVAL '730 days'
      ORDER BY created_at
      LIMIT p_batch_size
    )
    RETURNING *
  )
  INSERT INTO public.verdict_feedback_archive
  SELECT * FROM src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN QUERY SELECT 'verdict_feedback'::TEXT, v_moved;

  -- brand_impersonation_alerts (365d, by created_at)
  WITH src AS (
    DELETE FROM public.brand_impersonation_alerts
    WHERE id IN (
      SELECT id FROM public.brand_impersonation_alerts
      WHERE created_at < NOW() - INTERVAL '365 days'
      ORDER BY created_at
      LIMIT p_batch_size
    )
    RETURNING *
  )
  INSERT INTO public.brand_impersonation_alerts_archive
  SELECT * FROM src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN QUERY SELECT 'brand_impersonation_alerts'::TEXT, v_moved;
END;
$$;

-- Lockdown: anon + authenticated cannot call this (cron-only); service_role only.
REVOKE EXECUTE ON FUNCTION public.archive_secondary_tables_batch(INT)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_secondary_tables_batch(INT)
  TO service_role;

COMMENT ON FUNCTION public.archive_secondary_tables_batch(INT) IS
  'Batched archival mover for 6 medium-volume tables (flagged_ads, '
  'deepfake_detections, media_analyses, scan_results, verdict_feedback, '
  'brand_impersonation_alerts). Returns per-table deletion counts. '
  'Called nightly from the archive-shadows-retention Inngest function.';

-- Verification (run manually after apply):
-- SELECT to_regclass('public.flagged_ads_archive') IS NOT NULL,
--        to_regclass('public.deepfake_detections_archive') IS NOT NULL,
--        to_regclass('public.media_analyses_archive') IS NOT NULL,
--        to_regclass('public.scan_results_archive') IS NOT NULL,
--        to_regclass('public.verdict_feedback_archive') IS NOT NULL,
--        to_regclass('public.brand_impersonation_alerts_archive') IS NOT NULL;
--   → all 6 t.
--
-- Smoke: SELECT * FROM archive_secondary_tables_batch(5000);
--   → returns 6 rows, all with rows_moved=0 (no data old enough yet).
