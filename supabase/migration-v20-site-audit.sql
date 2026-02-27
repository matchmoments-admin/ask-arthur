-- Migration v20: Site audit tables for Website Safety Audit feature
-- Phase 1: sites + site_audits tables with RPC for atomic upsert

-- Sites table: one row per unique URL
CREATE TABLE IF NOT EXISTS sites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain TEXT NOT NULL,
  normalized_url TEXT NOT NULL UNIQUE,
  first_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latest_grade TEXT CHECK (latest_grade IN ('A+', 'A', 'B', 'C', 'D', 'F')),
  latest_score INTEGER CHECK (latest_score >= 0 AND latest_score <= 100),
  scan_count INTEGER NOT NULL DEFAULT 1,
  badge_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  badge_token TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites (domain);
CREATE INDEX IF NOT EXISTS idx_sites_badge_token ON sites (badge_token) WHERE badge_token IS NOT NULL;

-- Site audit results: one row per scan
CREATE TABLE IF NOT EXISTS site_audits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  grade TEXT NOT NULL CHECK (grade IN ('A+', 'A', 'B', 'C', 'D', 'F')),
  test_results JSONB NOT NULL DEFAULT '{}',
  category_scores JSONB NOT NULL DEFAULT '{}',
  recommendations TEXT[] DEFAULT '{}',
  duration_ms INTEGER,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_audits_site_scanned ON site_audits (site_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_audits_test_results ON site_audits USING GIN (test_results jsonb_path_ops);

-- RLS: public read, service-role write
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read sites" ON sites FOR SELECT USING (true);
CREATE POLICY "Service role write sites" ON sites FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public read site_audits" ON site_audits FOR SELECT USING (true);
CREATE POLICY "Service role write site_audits" ON site_audits FOR ALL USING (auth.role() = 'service_role');

-- RPC: Atomic upsert site + insert audit
CREATE OR REPLACE FUNCTION upsert_site_and_store_audit(
  p_domain TEXT,
  p_normalized_url TEXT,
  p_overall_score INTEGER,
  p_grade TEXT,
  p_test_results JSONB,
  p_category_scores JSONB,
  p_recommendations TEXT[],
  p_duration_ms INTEGER
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_site_id BIGINT;
  v_audit_id BIGINT;
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

  -- Insert audit
  INSERT INTO site_audits (site_id, overall_score, grade, test_results, category_scores, recommendations, duration_ms)
  VALUES (v_site_id, p_overall_score, p_grade, p_test_results, p_category_scores, p_recommendations, p_duration_ms)
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;
