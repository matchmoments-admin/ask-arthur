-- Migration v39: Provider Reporting & Action Tracking
-- Adds 2 tables (provider_reports, provider_actions) + 2 RPCs + RLS + indexes.
-- Enables tracking reports submitted to ACCC, AFP, ACSC, banks, and telcos.

BEGIN;

-- ============================================================
-- 1. provider_reports
--    Tracks reports submitted to external providers (gov, banks, telcos).
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_reports (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES scam_entities(id) ON DELETE CASCADE,
  provider_code     TEXT NOT NULL CHECK (provider_code IN (
                      'ACCC', 'AFP', 'ACSC',
                      'CBA', 'NAB', 'WBC', 'ANZ',
                      'TELSTRA', 'OPTUS'
                    )),
  report_type       TEXT NOT NULL CHECK (report_type IN (
                      'scam_report', 'takedown_request', 'fraud_alert',
                      'suspicious_activity', 'blocklist_submission'
                    )),
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                      'queued', 'submitted', 'acknowledged', 'actioned', 'closed'
                    )),
  reference_number  TEXT,
  payload           JSONB NOT NULL DEFAULT '{}',
  response          JSONB NOT NULL DEFAULT '{}',
  submitted_at      TIMESTAMPTZ,
  acknowledged_at   TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE provider_reports IS
  'Reports submitted to government agencies, banks, and telcos about scam entities';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_provider_reports_entity
  ON provider_reports (entity_id);

CREATE INDEX IF NOT EXISTS idx_provider_reports_provider
  ON provider_reports (provider_code);

CREATE INDEX IF NOT EXISTS idx_provider_reports_status
  ON provider_reports (status);

CREATE INDEX IF NOT EXISTS idx_provider_reports_created
  ON provider_reports (created_at DESC);

-- Partial unique index: prevent duplicate active reports per entity+provider+type
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_reports_no_duplicate_active
  ON provider_reports (entity_id, provider_code, report_type)
  WHERE status NOT IN ('closed');

-- ============================================================
-- 2. provider_actions
--    Actions taken by providers in response to reports.
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_actions (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_report_id  BIGINT NOT NULL REFERENCES provider_reports(id) ON DELETE CASCADE,
  action_type         TEXT NOT NULL CHECK (action_type IN (
                        'blocked', 'suspended', 'investigated',
                        'takedown', 'no_action'
                      )),
  action_detail       TEXT,
  actioned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE provider_actions IS
  'Actions taken by external providers in response to submitted reports';

CREATE INDEX IF NOT EXISTS idx_provider_actions_report
  ON provider_actions (provider_report_id);

CREATE INDEX IF NOT EXISTS idx_provider_actions_type
  ON provider_actions (action_type);

-- ============================================================
-- 3. RLS: Service-role only on both tables
-- ============================================================
ALTER TABLE provider_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on provider_reports"
  ON provider_reports
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY "Service role full access on provider_actions"
  ON provider_actions
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- ============================================================
-- 4. RPC: submit_provider_report
--    Creates a report, checks for duplicates, returns JSON.
-- ============================================================
CREATE OR REPLACE FUNCTION submit_provider_report(
  p_entity_id        BIGINT,
  p_provider_code    TEXT,
  p_report_type      TEXT,
  p_payload          JSONB    DEFAULT '{}',
  p_reference_number TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id BIGINT;
  v_new_id      BIGINT;
BEGIN
  -- Check for existing active report
  SELECT id INTO v_existing_id
  FROM provider_reports
  WHERE entity_id     = p_entity_id
    AND provider_code = p_provider_code
    AND report_type   = p_report_type
    AND status NOT IN ('closed')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN json_build_object(
      'success',     FALSE,
      'error',       'duplicate_active_report',
      'existing_id', v_existing_id,
      'message',     'An active report already exists for this entity/provider/type combination'
    )::JSONB;
  END IF;

  -- Insert new report
  INSERT INTO provider_reports (entity_id, provider_code, report_type, payload, reference_number, submitted_at)
  VALUES (p_entity_id, p_provider_code, p_report_type, p_payload, p_reference_number, NOW())
  RETURNING id INTO v_new_id;

  -- Update status to submitted
  UPDATE provider_reports
  SET status = 'submitted'
  WHERE id = v_new_id;

  RETURN json_build_object(
    'success',   TRUE,
    'report_id', v_new_id,
    'message',   'Report submitted successfully'
  )::JSONB;
END;
$$;

COMMENT ON FUNCTION submit_provider_report IS
  'Submit a scam entity report to a government agency, bank, or telco';

-- ============================================================
-- 5. RPC: get_unreported_entities
--    Finds entities meeting thresholds not yet reported to a given provider.
-- ============================================================
CREATE OR REPLACE FUNCTION get_unreported_entities(
  p_provider_code TEXT,
  p_risk_level    TEXT DEFAULT 'HIGH',
  p_min_reports   INT  DEFAULT 3,
  p_limit         INT  DEFAULT 100,
  p_offset        INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   BIGINT;
  v_results JSONB;
  v_risk_levels TEXT[];
BEGIN
  -- Build risk level filter: input level and above
  CASE p_risk_level
    WHEN 'CRITICAL' THEN v_risk_levels := ARRAY['CRITICAL'];
    WHEN 'HIGH'     THEN v_risk_levels := ARRAY['HIGH', 'CRITICAL'];
    WHEN 'MEDIUM'   THEN v_risk_levels := ARRAY['MEDIUM', 'HIGH', 'CRITICAL'];
    ELSE                  v_risk_levels := ARRAY['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  END CASE;

  -- Count
  SELECT COUNT(*)
  INTO v_total
  FROM scam_entities se
  WHERE se.risk_level = ANY(v_risk_levels)
    AND se.report_count >= p_min_reports
    AND NOT EXISTS (
      SELECT 1 FROM provider_reports pr
      WHERE pr.entity_id     = se.id
        AND pr.provider_code = p_provider_code
        AND pr.status NOT IN ('closed')
    );

  -- Fetch
  SELECT COALESCE(jsonb_agg(row_data), '[]'::JSONB)
  INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'entity_id',        se.id,
      'entity_type',      se.entity_type,
      'normalized_value', se.normalized_value,
      'risk_score',       se.risk_score,
      'risk_level',       se.risk_level,
      'report_count',     se.report_count,
      'first_seen',       se.first_seen,
      'last_seen',        se.last_seen,
      'feed_sources',     se.feed_sources
    ) AS row_data
    FROM scam_entities se
    WHERE se.risk_level = ANY(v_risk_levels)
      AND se.report_count >= p_min_reports
      AND NOT EXISTS (
        SELECT 1 FROM provider_reports pr
        WHERE pr.entity_id     = se.id
          AND pr.provider_code = p_provider_code
          AND pr.status NOT IN ('closed')
      )
    ORDER BY se.risk_score DESC, se.report_count DESC
    LIMIT  p_limit
    OFFSET p_offset
  ) sub;

  RETURN json_build_object(
    'total_count',    v_total,
    'provider_code',  p_provider_code,
    'risk_level',     p_risk_level,
    'min_reports',    p_min_reports,
    'limit',          p_limit,
    'offset',         p_offset,
    'data',           v_results
  )::JSONB;
END;
$$;

COMMENT ON FUNCTION get_unreported_entities IS
  'Find high-risk entities not yet reported to a specific provider';

COMMIT;
