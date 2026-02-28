-- Migration v21: Intelligence Core — unified reports, entities, and linkage
-- Enables cross-referencing: "which reports involved this phone number?"
-- Purely additive: no changes to existing tables.

-- =============================================================================
-- Table: scam_reports
-- Every user analysis creates a row (all verdicts). Central node for queries.
-- =============================================================================
CREATE TABLE IF NOT EXISTS scam_reports (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_hash   TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('web', 'extension', 'mobile', 'bot_telegram', 'bot_whatsapp', 'bot_slack', 'bot_messenger', 'api')),
  input_mode      TEXT CHECK (input_mode IN ('text', 'image', 'qrcode', 'email')),
  verdict         TEXT NOT NULL CHECK (verdict IN ('SAFE', 'SUSPICIOUS', 'HIGH_RISK')),
  confidence_score REAL NOT NULL,
  scam_type       TEXT,
  channel         TEXT,
  delivery_method TEXT,
  impersonated_brand TEXT,
  scrubbed_content TEXT,
  analysis_result JSONB NOT NULL DEFAULT '{}',
  verified_scam_id BIGINT REFERENCES verified_scams(id) ON DELETE SET NULL,
  region          TEXT,
  country_code    TEXT,
  cluster_id      BIGINT,  -- FK added in v22 after scam_clusters exists
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scam_reports_created ON scam_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scam_reports_verdict ON scam_reports (verdict);
CREATE INDEX IF NOT EXISTS idx_scam_reports_source ON scam_reports (source);
CREATE INDEX IF NOT EXISTS idx_scam_reports_scam_type ON scam_reports (scam_type);
CREATE INDEX IF NOT EXISTS idx_scam_reports_brand ON scam_reports (impersonated_brand);
CREATE INDEX IF NOT EXISTS idx_scam_reports_region ON scam_reports (region);
CREATE INDEX IF NOT EXISTS idx_scam_reports_verified ON scam_reports (verified_scam_id);
CREATE INDEX IF NOT EXISTS idx_scam_reports_cluster ON scam_reports (cluster_id);
CREATE INDEX IF NOT EXISTS idx_scam_reports_analysis ON scam_reports USING GIN (analysis_result jsonb_path_ops);

-- =============================================================================
-- Table: scam_entities
-- Unified entity lookup layer. One row per unique (type, normalized_value).
-- =============================================================================
CREATE TABLE IF NOT EXISTS scam_entities (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type            TEXT NOT NULL CHECK (entity_type IN ('phone', 'email', 'url', 'domain', 'ip', 'crypto_wallet', 'bank_account')),
  normalized_value       TEXT NOT NULL,
  raw_value              TEXT,
  canonical_entity_id    BIGINT,
  canonical_entity_table TEXT CHECK (canonical_entity_table IN ('scam_contacts', 'scam_urls', 'scam_ips', 'scam_crypto_wallets')),
  report_count           INT NOT NULL DEFAULT 1,
  first_seen             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, normalized_value)
);

CREATE INDEX IF NOT EXISTS idx_scam_entities_value ON scam_entities (normalized_value);
CREATE INDEX IF NOT EXISTS idx_scam_entities_type ON scam_entities (entity_type);
CREATE INDEX IF NOT EXISTS idx_scam_entities_report_count ON scam_entities (report_count DESC);
CREATE INDEX IF NOT EXISTS idx_scam_entities_canonical ON scam_entities (canonical_entity_table, canonical_entity_id);

-- =============================================================================
-- Table: report_entity_links
-- Many-to-many junction. This is the table that fixes reportability.
-- =============================================================================
CREATE TABLE IF NOT EXISTS report_entity_links (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id         BIGINT NOT NULL REFERENCES scam_reports(id) ON DELETE CASCADE,
  entity_id         BIGINT NOT NULL REFERENCES scam_entities(id) ON DELETE CASCADE,
  extraction_method TEXT NOT NULL DEFAULT 'regex' CHECK (extraction_method IN ('regex', 'claude', 'ocr', 'manual', 'feed')),
  role              TEXT NOT NULL DEFAULT 'mentioned' CHECK (role IN ('sender', 'recipient', 'mentioned', 'payment_target', 'redirect_target')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, entity_id, role)
);

CREATE INDEX IF NOT EXISTS idx_rel_report ON report_entity_links (report_id);
CREATE INDEX IF NOT EXISTS idx_rel_entity ON report_entity_links (entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_entity_report ON report_entity_links (entity_id, report_id);

-- =============================================================================
-- RLS: public read, service-role write (matches v20 pattern)
-- =============================================================================
ALTER TABLE scam_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE scam_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_entity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read scam_reports" ON scam_reports FOR SELECT USING (true);
CREATE POLICY "Service role write scam_reports" ON scam_reports FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public read scam_entities" ON scam_entities FOR SELECT USING (true);
CREATE POLICY "Service role write scam_entities" ON scam_entities FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public read report_entity_links" ON report_entity_links FOR SELECT USING (true);
CREATE POLICY "Service role write report_entity_links" ON report_entity_links FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- RPC: create_scam_report — inserts a report row, returns the new ID
-- =============================================================================
CREATE OR REPLACE FUNCTION create_scam_report(
  p_reporter_hash TEXT,
  p_source TEXT,
  p_input_mode TEXT,
  p_verdict TEXT,
  p_confidence_score REAL,
  p_scam_type TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL,
  p_delivery_method TEXT DEFAULT NULL,
  p_impersonated_brand TEXT DEFAULT NULL,
  p_scrubbed_content TEXT DEFAULT NULL,
  p_analysis_result JSONB DEFAULT '{}',
  p_verified_scam_id BIGINT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO scam_reports (
    reporter_hash, source, input_mode, verdict, confidence_score,
    scam_type, channel, delivery_method, impersonated_brand,
    scrubbed_content, analysis_result, verified_scam_id, region, country_code
  ) VALUES (
    p_reporter_hash, p_source, p_input_mode, p_verdict, p_confidence_score,
    p_scam_type, p_channel, p_delivery_method, p_impersonated_brand,
    p_scrubbed_content, p_analysis_result, p_verified_scam_id, p_region, p_country_code
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- =============================================================================
-- RPC: upsert_scam_entity — insert or bump report_count, returns JSON
-- Uses xmax = 0 trick to detect insert vs update (matches existing patterns)
-- =============================================================================
CREATE OR REPLACE FUNCTION upsert_scam_entity(
  p_entity_type TEXT,
  p_normalized_value TEXT,
  p_raw_value TEXT DEFAULT NULL,
  p_canonical_entity_id BIGINT DEFAULT NULL,
  p_canonical_entity_table TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id BIGINT;
  v_is_new BOOLEAN;
BEGIN
  INSERT INTO scam_entities (entity_type, normalized_value, raw_value, canonical_entity_id, canonical_entity_table)
  VALUES (p_entity_type, p_normalized_value, p_raw_value, p_canonical_entity_id, p_canonical_entity_table)
  ON CONFLICT (entity_type, normalized_value) DO UPDATE SET
    report_count = scam_entities.report_count + 1,
    last_seen = NOW(),
    raw_value = COALESCE(EXCLUDED.raw_value, scam_entities.raw_value)
  RETURNING id, (xmax = 0) INTO v_id, v_is_new;

  RETURN json_build_object('entity_id', v_id, 'is_new', v_is_new);
END;
$$;

-- =============================================================================
-- RPC: link_report_entity — create junction row, idempotent via ON CONFLICT
-- =============================================================================
CREATE OR REPLACE FUNCTION link_report_entity(
  p_report_id BIGINT,
  p_entity_id BIGINT,
  p_extraction_method TEXT DEFAULT 'regex',
  p_role TEXT DEFAULT 'mentioned'
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO report_entity_links (report_id, entity_id, extraction_method, role)
  VALUES (p_report_id, p_entity_id, p_extraction_method, p_role)
  ON CONFLICT (report_id, entity_id, role) DO NOTHING
  RETURNING id INTO v_id;

  -- If conflict, return existing link id
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM report_entity_links
    WHERE report_id = p_report_id AND entity_id = p_entity_id AND role = p_role;
  END IF;

  RETURN v_id;
END;
$$;
