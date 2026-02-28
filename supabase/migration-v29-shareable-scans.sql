-- Migration v29: Shareable scan URLs via UUID token on site_audits

ALTER TABLE site_audits
  ADD COLUMN IF NOT EXISTS share_token UUID DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_audits_share_token
  ON site_audits (share_token);

-- Drop the old function first (return type changed from BIGINT to TABLE)
DROP FUNCTION IF EXISTS upsert_site_and_store_audit(text,text,integer,text,jsonb,jsonb,text[],integer);

-- Recreate with new return type: (audit_id, share_token)
CREATE OR REPLACE FUNCTION upsert_site_and_store_audit(
  p_domain TEXT,
  p_normalized_url TEXT,
  p_overall_score INTEGER,
  p_grade TEXT,
  p_test_results JSONB,
  p_category_scores JSONB,
  p_recommendations TEXT[],
  p_duration_ms INTEGER
) RETURNS TABLE(audit_id BIGINT, share_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_site_id BIGINT;
  v_audit_id BIGINT;
  v_share_token UUID;
BEGIN
  -- Upsert site
  INSERT INTO sites (domain, normalized_url, latest_grade, latest_score)
  VALUES (p_domain, p_normalized_url, p_grade, p_overall_score)
  ON CONFLICT (normalized_url) DO UPDATE SET
    last_scanned_at = NOW(),
    latest_grade = EXCLUDED.latest_grade,
    latest_score = EXCLUDED.latest_score,
    scan_count = sites.scan_count + 1
  RETURNING id INTO v_site_id;

  -- Insert audit (share_token auto-generated via DEFAULT)
  INSERT INTO site_audits (site_id, overall_score, grade, test_results, category_scores, recommendations, duration_ms)
  VALUES (v_site_id, p_overall_score, p_grade, p_test_results, p_category_scores, p_recommendations, p_duration_ms)
  RETURNING id, site_audits.share_token INTO v_audit_id, v_share_token;

  RETURN QUERY SELECT v_audit_id, v_share_token;
END;
$$;
