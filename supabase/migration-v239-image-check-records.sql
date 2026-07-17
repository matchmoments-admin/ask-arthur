-- Migration v239: image_check_records — evidence records for flagged image checks
-- Image-check v2 PR 4 (docs/plans/image-check-v2.md, ADR-0022).
--
-- Posture (ADR-0022, supersedes-in-part ADR-0010): METADATA ONLY, FLAGGED
-- CHECKS ONLY, NEVER IMAGE BYTES. The public "images are discarded" promise
-- holds for pixel data; image_sha256 lets a third party who already holds
-- the image corroborate it. install_id is stored only as its SHA-256.
-- check_ref is IC- + 12 Crockford-base32 chars (~60 bits) — the public
-- evidence page (/image-check/[ref], PR 5) is keyed on it alone.

CREATE TABLE IF NOT EXISTS public.image_check_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_ref TEXT NOT NULL UNIQUE,
  install_id_hash TEXT NOT NULL,
  image_url TEXT,
  page_url TEXT,
  image_sha256 TEXT,
  ai_confidence NUMERIC(5, 4),
  deepfake_confidence NUMERIC(5, 4),
  generator_source TEXT,
  generator_breakdown JSONB,
  content_credentials JSONB,
  vision_summary TEXT,
  impersonated_brand TEXT,
  impersonated_celebrity TEXT,
  hive_result JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_check_records_checked_at
  ON public.image_check_records (checked_at);

ALTER TABLE public.image_check_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "image_check_records_service_all" ON public.image_check_records;
CREATE POLICY "image_check_records_service_all" ON public.image_check_records FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Archive shadow (v118 pattern: LIKE INCLUDING DEFAULTS — no constraints /
-- indexes / RLS carried over; BRIN on the time column; deny-all restrictive).
CREATE TABLE IF NOT EXISTS public.image_check_records_archive
  (LIKE public.image_check_records INCLUDING DEFAULTS);
CREATE INDEX IF NOT EXISTS idx_image_check_records_archive_checked_brin
  ON public.image_check_records_archive USING BRIN (checked_at);
ALTER TABLE public.image_check_records_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.image_check_records_archive;
CREATE POLICY deny_all_anon_authenticated ON public.image_check_records_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Extend the batched archival mover (v118) with a 7th block. Full function
-- re-issued (CREATE OR REPLACE) — keep SECURITY DEFINER + pinned search_path.
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

  -- image_check_records (365d, by checked_at — v239, image-check v2 PR 4)
  WITH src AS (
    DELETE FROM public.image_check_records
    WHERE id IN (
      SELECT id FROM public.image_check_records
      WHERE checked_at < NOW() - INTERVAL '365 days'
      ORDER BY checked_at
      LIMIT p_batch_size
    )
    RETURNING *
  )
  INSERT INTO public.image_check_records_archive
  SELECT * FROM src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN QUERY SELECT 'image_check_records'::TEXT, v_moved;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_secondary_tables_batch(INT)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_secondary_tables_batch(INT)
  TO service_role;

COMMENT ON FUNCTION public.archive_secondary_tables_batch(INT) IS
  'Batched archival mover for 7 medium-volume tables (flagged_ads, '
  'deepfake_detections, media_analyses, scan_results, verdict_feedback, '
  'brand_impersonation_alerts, image_check_records). Returns per-table '
  'deletion counts. Called nightly from the archive-shadows-retention '
  'Inngest function.';
