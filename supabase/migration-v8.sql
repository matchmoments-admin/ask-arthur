-- migration-v8: Scam Contact Database
-- Community-reported scam phone numbers and email addresses
-- Run in Supabase SQL Editor

-- ══════════════════════════════════════════════
-- Table: scam_contacts (canonical scam contact records)
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scam_contacts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  normalized_value TEXT NOT NULL UNIQUE,          -- E.164 phone or lowercase email
  contact_type    TEXT NOT NULL CHECK (contact_type IN ('phone', 'email')),
  report_count    INT DEFAULT 1,
  unique_reporter_count INT DEFAULT 1,
  confidence_score REAL DEFAULT 0.0,              -- Composite 0.0–1.0
  confidence_level TEXT DEFAULT 'low' CHECK (confidence_level IN ('low', 'medium', 'high', 'confirmed')),
  current_carrier TEXT,                           -- From Twilio
  line_type       TEXT,                           -- mobile/landline/nonFixedVoip etc.
  is_voip         BOOLEAN DEFAULT false,
  primary_scam_type TEXT,                         -- From Claude
  brand_impersonated TEXT,                        -- From Claude
  country_code    TEXT,                           -- From Twilio
  email_domain    TEXT,                           -- For emails only
  first_reported_at TIMESTAMPTZ DEFAULT NOW(),
  last_reported_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scam_contacts_type ON scam_contacts (contact_type);
CREATE INDEX IF NOT EXISTS idx_scam_contacts_confidence ON scam_contacts (confidence_score);
CREATE INDEX IF NOT EXISTS idx_scam_contacts_last_reported ON scam_contacts (last_reported_at);
CREATE INDEX IF NOT EXISTS idx_scam_contacts_brand ON scam_contacts (brand_impersonated);

-- ══════════════════════════════════════════════
-- Table: scam_contact_reports (individual reports, audit trail)
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scam_contact_reports (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scam_contact_id BIGINT NOT NULL REFERENCES scam_contacts(id) ON DELETE CASCADE,
  scam_type       TEXT,                           -- Per-report (may differ from primary)
  brand_impersonated TEXT,                        -- Per-report
  reporter_hash   TEXT NOT NULL,                  -- SHA-256 of session (IP+UA), never PII
  source          TEXT DEFAULT 'user_report',     -- user_report / analysis_pipeline / partner_feed
  channel         TEXT,                           -- call/sms/email/whatsapp
  region          TEXT,                           -- Geo-IP state
  analysis_id     BIGINT,                         -- FK-ish link to verified_scams (nullable)
  reported_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scam_reports_contact ON scam_contact_reports (scam_contact_id);
CREATE INDEX IF NOT EXISTS idx_scam_reports_reporter ON scam_contact_reports (reporter_hash);
CREATE INDEX IF NOT EXISTS idx_scam_reports_reported_at ON scam_contact_reports (reported_at);

-- ══════════════════════════════════════════════
-- RLS Policies (explicit per-operation, matching v7 pattern)
-- ══════════════════════════════════════════════

ALTER TABLE scam_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scam_contact_reports ENABLE ROW LEVEL SECURITY;

-- scam_contacts: public SELECT (restricted columns via API layer), service role full access
CREATE POLICY "Public can select scam contacts" ON scam_contacts FOR SELECT USING (true);
CREATE POLICY "Service role can insert scam contacts" ON scam_contacts FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update scam contacts" ON scam_contacts FOR UPDATE USING (true);
CREATE POLICY "Service role can delete scam contacts" ON scam_contacts FOR DELETE USING (true);

-- scam_contact_reports: service role only
CREATE POLICY "Service role can select reports" ON scam_contact_reports FOR SELECT USING (true);
CREATE POLICY "Service role can insert reports" ON scam_contact_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update reports" ON scam_contact_reports FOR UPDATE USING (true);
CREATE POLICY "Service role can delete reports" ON scam_contact_reports FOR DELETE USING (true);

-- ══════════════════════════════════════════════
-- Function: upsert_scam_contact
-- Atomically upserts a scam contact + creates a report row
-- Returns: scam_contact_id, report_count, is_new
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION upsert_scam_contact(
  p_normalized_value TEXT,
  p_contact_type TEXT,
  p_reporter_hash TEXT,
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
  v_contact_id BIGINT;
  v_is_new BOOLEAN := false;
  v_report_count INT;
  v_unique_count INT;
  v_is_voip BOOLEAN;
  v_score REAL;
  v_level TEXT;
  v_reporter_exists BOOLEAN;
BEGIN
  -- Upsert scam_contacts: insert or update on conflict
  INSERT INTO scam_contacts (normalized_value, contact_type, primary_scam_type, brand_impersonated)
  VALUES (p_normalized_value, p_contact_type, p_scam_type, p_brand_impersonated)
  ON CONFLICT (normalized_value) DO UPDATE SET
    report_count = scam_contacts.report_count + 1,
    last_reported_at = NOW(),
    primary_scam_type = COALESCE(EXCLUDED.primary_scam_type, scam_contacts.primary_scam_type),
    brand_impersonated = COALESCE(EXCLUDED.brand_impersonated, scam_contacts.brand_impersonated)
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_contact_id, v_is_new;

  -- Check if this reporter has reported this contact before
  SELECT EXISTS (
    SELECT 1 FROM scam_contact_reports
    WHERE scam_contact_id = v_contact_id AND reporter_hash = p_reporter_hash
  ) INTO v_reporter_exists;

  -- If new unique reporter, increment unique_reporter_count
  IF NOT v_reporter_exists AND NOT v_is_new THEN
    UPDATE scam_contacts
    SET unique_reporter_count = unique_reporter_count + 1
    WHERE id = v_contact_id;
  END IF;

  -- Insert the report row
  INSERT INTO scam_contact_reports (
    scam_contact_id, scam_type, brand_impersonated, reporter_hash,
    source, channel, region, analysis_id
  ) VALUES (
    v_contact_id, p_scam_type, p_brand_impersonated, p_reporter_hash,
    'user_report', p_channel, p_region, p_analysis_id
  );

  -- Recalculate confidence score
  SELECT report_count, unique_reporter_count, is_voip
  FROM scam_contacts WHERE id = v_contact_id
  INTO v_report_count, v_unique_count, v_is_voip;

  v_score := LEAST(1.0, (v_report_count * 0.15) + (v_unique_count * 0.1) + (v_is_voip::int * 0.2));
  v_level := CASE
    WHEN v_score >= 0.8 THEN 'confirmed'
    WHEN v_score >= 0.5 THEN 'high'
    WHEN v_score >= 0.3 THEN 'medium'
    ELSE 'low'
  END;

  UPDATE scam_contacts
  SET confidence_score = v_score, confidence_level = v_level
  WHERE id = v_contact_id;

  RETURN json_build_object(
    'scam_contact_id', v_contact_id,
    'report_count', v_report_count,
    'is_new', v_is_new
  );
END;
$$;
