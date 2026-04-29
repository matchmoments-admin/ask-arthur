-- Migration v81: persist partial-scan, fetch_error, raw_headers and
-- structured recommendations on site_audits.
--
-- Why: stored scans rendered with partial:false hardcoded and a TEXT[]
-- recommendations column that silently stringified Recommendation objects
-- (supabase-js coerces objects to JSON-encoded strings when the target
-- type is text[]). Users landing on /scan/<token> for a partial scan saw
-- an F grade with no banner explaining the fetch was blocked, and saw
-- raw JSON in the recommendations list.
--
-- Idempotent: re-running adds nothing new; ALTER TABLE ... ADD COLUMN IF
-- NOT EXISTS and the function recreate are both safe.

-- 1. New columns
ALTER TABLE site_audits
  ADD COLUMN IF NOT EXISTS partial            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fetch_error        JSONB,
  ADD COLUMN IF NOT EXISTS raw_headers        JSONB,
  ADD COLUMN IF NOT EXISTS recommendations_v2 JSONB;

-- 2. Replace the RPC. New params have defaults so the signature change is
--    forward-only; legacy callers that don't pass the new fields still
--    work, but the API route is updated in this PR to populate them.
DROP FUNCTION IF EXISTS upsert_site_and_store_audit(text,text,integer,text,jsonb,jsonb,text[],integer);
DROP FUNCTION IF EXISTS upsert_site_and_store_audit(text,text,integer,text,jsonb,jsonb,jsonb,integer,boolean,jsonb,jsonb);

CREATE OR REPLACE FUNCTION upsert_site_and_store_audit(
  p_domain TEXT,
  p_normalized_url TEXT,
  p_overall_score INTEGER,
  p_grade TEXT,
  p_test_results JSONB,
  p_category_scores JSONB,
  p_recommendations JSONB,
  p_duration_ms INTEGER,
  p_partial BOOLEAN DEFAULT false,
  p_fetch_error JSONB DEFAULT NULL,
  p_raw_headers JSONB DEFAULT NULL
) RETURNS TABLE(audit_id BIGINT, share_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_site_id BIGINT;
  v_audit_id BIGINT;
  v_share_token UUID;
BEGIN
  INSERT INTO sites (domain, normalized_url, latest_grade, latest_score)
  VALUES (p_domain, p_normalized_url, p_grade, p_overall_score)
  ON CONFLICT (normalized_url) DO UPDATE SET
    last_scanned_at = NOW(),
    latest_grade = EXCLUDED.latest_grade,
    latest_score = EXCLUDED.latest_score,
    scan_count = sites.scan_count + 1
  RETURNING id INTO v_site_id;

  INSERT INTO site_audits (
    site_id, overall_score, grade,
    test_results, category_scores,
    recommendations_v2, duration_ms,
    partial, fetch_error, raw_headers
  )
  VALUES (
    v_site_id, p_overall_score, p_grade,
    p_test_results, p_category_scores,
    p_recommendations, p_duration_ms,
    p_partial, p_fetch_error, p_raw_headers
  )
  RETURNING id, site_audits.share_token INTO v_audit_id, v_share_token;

  RETURN QUERY SELECT v_audit_id, v_share_token;
END;
$$;
