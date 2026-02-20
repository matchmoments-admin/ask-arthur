-- migration-v9: Scam URL Database
-- Community-reported scam URLs with WHOIS/SSL enrichment
-- Run in Supabase SQL Editor

-- ══════════════════════════════════════════════
-- Table: scam_urls (canonical scam URL records)
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scam_urls (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  normalized_url        TEXT NOT NULL UNIQUE,            -- full URL, lowercased, tracking params stripped
  domain                TEXT NOT NULL,                   -- extracted domain
  subdomain             TEXT,                            -- e.g. "login" from "login.fake-telstra.com"
  tld                   TEXT NOT NULL,                   -- ".com", ".com.au", ".xyz"
  full_path             TEXT,                            -- path + query string
  source_type           TEXT DEFAULT 'text',             -- text | email | qr_code | sms
  report_count          INT DEFAULT 1,
  unique_reporter_count INT DEFAULT 1,
  confidence_score      REAL DEFAULT 0.0,                -- Composite 0.0–1.0
  confidence_level      TEXT DEFAULT 'low' CHECK (confidence_level IN ('low', 'medium', 'high', 'confirmed')),
  primary_scam_type     TEXT,                            -- From Claude
  brand_impersonated    TEXT,                            -- From Claude
  google_safe_browsing  BOOLEAN,                         -- flagged by GSB?
  virustotal_malicious  INT DEFAULT 0,                   -- # of VT engines flagging
  virustotal_score      TEXT,                            -- "5/92" format
  whois_registrar       TEXT,
  whois_registrant_country TEXT,
  whois_created_date    DATE,
  whois_expires_date    DATE,
  whois_name_servers    TEXT[],
  whois_is_private      BOOLEAN,
  whois_raw             JSONB,
  whois_lookup_at       TIMESTAMPTZ,
  ssl_valid             BOOLEAN,
  ssl_issuer            TEXT,
  ssl_days_remaining    INT,
  first_reported_at     TIMESTAMPTZ DEFAULT NOW(),
  last_reported_at      TIMESTAMPTZ DEFAULT NOW(),
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scam_urls_domain ON scam_urls (domain);
CREATE INDEX IF NOT EXISTS idx_scam_urls_confidence ON scam_urls (confidence_level) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_scam_urls_brand ON scam_urls (brand_impersonated) WHERE brand_impersonated IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scam_urls_last_reported ON scam_urls (last_reported_at DESC);

-- ══════════════════════════════════════════════
-- Table: scam_url_reports (individual reports, audit trail)
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scam_url_reports (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scam_url_id     BIGINT NOT NULL REFERENCES scam_urls(id) ON DELETE CASCADE,
  source_type     TEXT,                            -- text | email | qr_code | sms
  scam_type       TEXT,                            -- Per-report (may differ from primary)
  brand_impersonated TEXT,                         -- Per-report
  reporter_hash   TEXT NOT NULL,                   -- SHA-256 of session (IP+UA), never PII
  source          TEXT DEFAULT 'user_report',      -- user_report / analysis_pipeline / partner_feed
  channel         TEXT,                            -- call/sms/email/whatsapp
  region          TEXT,                            -- Geo-IP state
  analysis_id     BIGINT,                          -- FK-ish link to verified_scams (nullable)
  reported_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scam_url_reports_url ON scam_url_reports (scam_url_id);
CREATE INDEX IF NOT EXISTS idx_scam_url_reports_reporter ON scam_url_reports (reporter_hash);

-- ══════════════════════════════════════════════
-- RLS Policies (explicit per-operation, matching v8 pattern)
-- ══════════════════════════════════════════════

ALTER TABLE scam_urls ENABLE ROW LEVEL SECURITY;
ALTER TABLE scam_url_reports ENABLE ROW LEVEL SECURITY;

-- scam_urls: public SELECT (restricted columns via API layer), service role full access
CREATE POLICY "Public can select scam urls" ON scam_urls FOR SELECT USING (true);
CREATE POLICY "Service role can insert scam urls" ON scam_urls FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update scam urls" ON scam_urls FOR UPDATE USING (true);
CREATE POLICY "Service role can delete scam urls" ON scam_urls FOR DELETE USING (true);

-- scam_url_reports: service role only
CREATE POLICY "Service role can select url reports" ON scam_url_reports FOR SELECT USING (true);
CREATE POLICY "Service role can insert url reports" ON scam_url_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update url reports" ON scam_url_reports FOR UPDATE USING (true);
CREATE POLICY "Service role can delete url reports" ON scam_url_reports FOR DELETE USING (true);

-- ══════════════════════════════════════════════
-- Function: upsert_scam_url
-- Atomically upserts a scam URL + creates a report row
-- Returns: scam_url_id, report_count, is_new
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION upsert_scam_url(
  p_normalized_url TEXT,
  p_domain TEXT,
  p_subdomain TEXT DEFAULT NULL,
  p_tld TEXT DEFAULT '',
  p_full_path TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT 'text',
  p_reporter_hash TEXT DEFAULT '',
  p_scam_type TEXT DEFAULT NULL,
  p_brand_impersonated TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_analysis_id BIGINT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url_id BIGINT;
  v_is_new BOOLEAN := false;
  v_report_count INT;
  v_unique_count INT;
  v_reporter_exists BOOLEAN;
  v_score REAL;
  v_level TEXT;
  v_gsb BOOLEAN;
  v_vt_malicious INT;
  v_whois_created DATE;
  v_domain_age_days INT;
BEGIN
  -- Upsert scam_urls: insert or update on conflict
  INSERT INTO scam_urls (
    normalized_url, domain, subdomain, tld, full_path,
    source_type, primary_scam_type, brand_impersonated
  )
  VALUES (
    p_normalized_url, p_domain, p_subdomain, p_tld, p_full_path,
    p_source_type, p_scam_type, p_brand_impersonated
  )
  ON CONFLICT (normalized_url) DO UPDATE SET
    report_count = scam_urls.report_count + 1,
    last_reported_at = NOW(),
    primary_scam_type = COALESCE(EXCLUDED.primary_scam_type, scam_urls.primary_scam_type),
    brand_impersonated = COALESCE(EXCLUDED.brand_impersonated, scam_urls.brand_impersonated)
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_url_id, v_is_new;

  -- Check if this reporter has reported this URL before
  SELECT EXISTS (
    SELECT 1 FROM scam_url_reports
    WHERE scam_url_id = v_url_id AND reporter_hash = p_reporter_hash
  ) INTO v_reporter_exists;

  -- If new unique reporter, increment unique_reporter_count
  IF NOT v_reporter_exists AND NOT v_is_new THEN
    UPDATE scam_urls
    SET unique_reporter_count = unique_reporter_count + 1
    WHERE id = v_url_id;
  END IF;

  -- Insert the report row
  INSERT INTO scam_url_reports (
    scam_url_id, source_type, scam_type, brand_impersonated, reporter_hash,
    source, channel, region, analysis_id
  ) VALUES (
    v_url_id, p_source_type, p_scam_type, p_brand_impersonated, p_reporter_hash,
    'user_report', p_channel, p_region, p_analysis_id
  );

  -- Recalculate confidence score
  SELECT report_count, unique_reporter_count, google_safe_browsing,
         virustotal_malicious, whois_created_date
  FROM scam_urls WHERE id = v_url_id
  INTO v_report_count, v_unique_count, v_gsb, v_vt_malicious, v_whois_created;

  -- Report count factor: up to 0.40 (logarithmic)
  v_score := LEAST(0.40, LN(v_report_count + 1) / LN(50));

  -- Reporter diversity: up to 0.15
  v_score := v_score + LEAST(0.15, v_unique_count::REAL / 20.0);

  -- Recency: 0.10 if reported in last 7 days, else 0.05
  IF (NOW() - (SELECT last_reported_at FROM scam_urls WHERE id = v_url_id)) < INTERVAL '7 days' THEN
    v_score := v_score + 0.10;
  ELSE
    v_score := v_score + 0.05;
  END IF;

  -- GSB flag: +0.15
  IF v_gsb = TRUE THEN
    v_score := v_score + 0.15;
  END IF;

  -- VT flag: up to 0.10
  v_score := v_score + LEAST(0.10, COALESCE(v_vt_malicious, 0)::REAL / 10.0);

  -- Domain age: +0.10 if < 30 days, +0.05 if < 90 days
  IF v_whois_created IS NOT NULL THEN
    v_domain_age_days := (CURRENT_DATE - v_whois_created);
    IF v_domain_age_days < 30 THEN
      v_score := v_score + 0.10;
    ELSIF v_domain_age_days < 90 THEN
      v_score := v_score + 0.05;
    END IF;
  END IF;

  v_score := LEAST(1.0, v_score);

  v_level := CASE
    WHEN v_score >= 0.8 THEN 'confirmed'
    WHEN v_score >= 0.5 THEN 'high'
    WHEN v_score >= 0.3 THEN 'medium'
    ELSE 'low'
  END;

  UPDATE scam_urls
  SET confidence_score = v_score, confidence_level = v_level
  WHERE id = v_url_id;

  RETURN json_build_object(
    'scam_url_id', v_url_id,
    'report_count', v_report_count,
    'is_new', v_is_new
  );
END;
$$;
