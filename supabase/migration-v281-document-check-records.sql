-- Migration v281: document_check_records — evidence records for flagged document checks
-- Document Check Module Stage 2 (plan: ~/.claude/plans doc-check; ADR-0022 pattern).
--
-- Posture (ADR-0022 applied to documents): METADATA ONLY, FLAGGED CHECKS
-- ONLY, NEVER DOCUMENT BYTES, NEVER EXTRACTED TEXT. structural_summary and
-- abn_summary carry only display-safe fields (tool names, counts, dates,
-- ABN digits + register statuses — public-register facts). check_ref is
-- DC- + 12 Crockford-base32 chars (~60 bits) — the public evidence page
-- (/document-check/[ref]) is keyed on it alone. org_id scopes B2B rows to
-- the API caller's organisation; web rows carry neither org nor key.

CREATE TABLE IF NOT EXISTS public.document_check_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_ref TEXT NOT NULL UNIQUE,
  doc_sha256 TEXT NOT NULL,
  doc_type TEXT,
  jurisdiction TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  org_id UUID,
  api_key_hash TEXT,
  structural_summary JSONB,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  abn_summary JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_check_records_checked_at
  ON public.document_check_records (checked_at);
CREATE INDEX IF NOT EXISTS idx_document_check_records_org
  ON public.document_check_records (org_id, checked_at)
  WHERE org_id IS NOT NULL;

ALTER TABLE public.document_check_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "document_check_records_service_all" ON public.document_check_records;
CREATE POLICY "document_check_records_service_all" ON public.document_check_records FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Archive shadow (v118 pattern: LIKE INCLUDING DEFAULTS — no constraints /
-- indexes / RLS carried over; BRIN on the time column; deny-all). Created in
-- the SAME migration as the parent so the mover's positional
-- INSERT ... SELECT * can never 42601 on column drift (the v247 incident).
CREATE TABLE IF NOT EXISTS public.document_check_records_archive
  (LIKE public.document_check_records INCLUDING DEFAULTS);
CREATE INDEX IF NOT EXISTS idx_document_check_records_archive_checked_brin
  ON public.document_check_records_archive USING BRIN (checked_at);
ALTER TABLE public.document_check_records_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.document_check_records_archive;
CREATE POLICY deny_all_anon_authenticated ON public.document_check_records_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Extend the nightly mover with the new table (full replace — the function
-- enumerates its tables inline; v239 is the previous definition).
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

  -- document_check_records (365d, by checked_at — v281, document-check Stage 2)
  WITH src AS (
    DELETE FROM public.document_check_records
    WHERE id IN (
      SELECT id FROM public.document_check_records
      WHERE checked_at < NOW() - INTERVAL '365 days'
      ORDER BY checked_at
      LIMIT p_batch_size
    )
    RETURNING *
  )
  INSERT INTO public.document_check_records_archive
  SELECT * FROM src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN QUERY SELECT 'document_check_records'::TEXT, v_moved;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_secondary_tables_batch(INT)
  FROM anon, authenticated, PUBLIC;

-- v239 ended with a GRANT + COMMENT that a full-replace would drop on a
-- fresh environment (CREATE OR REPLACE preserves ACLs in-place, but a
-- preview-branch bootstrap or DR restore applying only later migrations
-- would leave service_role without EXECUTE after the REVOKE) — restate
-- both, with the table count kept true.
GRANT EXECUTE ON FUNCTION public.archive_secondary_tables_batch(INT)
  TO service_role;
COMMENT ON FUNCTION public.archive_secondary_tables_batch(INT) IS
  'Nightly batch mover: archives 8 medium-volume tables to their _archive twins (flagged_ads, deepfake_detections, media_analyses 180d, scan_results, verdict_feedback 730d, brand_impersonation_alerts, image_check_records, document_check_records; default 365d). Called by the archive-shadows-retention Inngest cron.';
