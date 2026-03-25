-- migration-v11: Unified scan results table for all scanner types

CREATE TABLE IF NOT EXISTS scan_results (
  id SERIAL PRIMARY KEY,
  scan_type TEXT NOT NULL CHECK (scan_type IN ('website', 'extension', 'mcp-server', 'skill')),
  target TEXT NOT NULL,
  target_display TEXT,
  overall_score INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT 'F',
  result JSONB NOT NULL DEFAULT '{}',
  share_token UUID NOT NULL DEFAULT gen_random_uuid(),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private')),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scan_results_share_token_unique UNIQUE (share_token)
);

CREATE INDEX IF NOT EXISTS idx_scan_results_target ON scan_results(scan_type, target);
CREATE INDEX IF NOT EXISTS idx_scan_results_public ON scan_results(visibility, scanned_at DESC) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_scan_results_share ON scan_results(share_token);

-- RPC to upsert a scan result (update if same target scanned again)
CREATE OR REPLACE FUNCTION upsert_scan_result(
  p_scan_type TEXT,
  p_target TEXT,
  p_target_display TEXT,
  p_overall_score INTEGER,
  p_grade TEXT,
  p_result JSONB,
  p_visibility TEXT DEFAULT 'public'
) RETURNS TABLE(id INTEGER, share_token UUID, is_new BOOLEAN) AS $$
DECLARE
  v_id INTEGER;
  v_token UUID;
  v_is_new BOOLEAN;
BEGIN
  -- Check for existing scan of same target
  SELECT sr.id, sr.share_token INTO v_id, v_token
  FROM scan_results sr
  WHERE sr.scan_type = p_scan_type AND sr.target = p_target
  ORDER BY sr.scanned_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Update existing
    UPDATE scan_results
    SET overall_score = p_overall_score,
        grade = p_grade,
        result = p_result,
        target_display = p_target_display,
        scanned_at = now()
    WHERE scan_results.id = v_id;
    v_is_new := FALSE;
    RETURN QUERY SELECT v_id, v_token, v_is_new;
  ELSE
    -- Insert new
    INSERT INTO scan_results (scan_type, target, target_display, overall_score, grade, result, visibility)
    VALUES (p_scan_type, p_target, p_target_display, p_overall_score, p_grade, p_result, p_visibility)
    RETURNING scan_results.id, scan_results.share_token, TRUE
    INTO v_id, v_token, v_is_new;
    RETURN QUERY SELECT v_id, v_token, v_is_new;
  END IF;
END;
$$ LANGUAGE plpgsql;
