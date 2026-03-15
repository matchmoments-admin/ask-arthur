-- Migration v40: Financial Impact & Jurisdiction
-- Adds 4 columns to scam_reports + 1 view + 2 RPCs + indexes.
-- Enables financial loss tracking and jurisdiction-based reporting.

BEGIN;

-- ============================================================
-- 1. ALTER scam_reports: add financial/jurisdiction columns
-- ============================================================
ALTER TABLE scam_reports
  ADD COLUMN IF NOT EXISTS estimated_loss  NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS loss_currency   TEXT DEFAULT 'AUD',
  ADD COLUMN IF NOT EXISTS target_region   TEXT,
  ADD COLUMN IF NOT EXISTS target_country  TEXT;

COMMENT ON COLUMN scam_reports.estimated_loss  IS 'Reported financial loss amount (nullable)';
COMMENT ON COLUMN scam_reports.loss_currency   IS 'ISO 4217 currency code for the loss amount';
COMMENT ON COLUMN scam_reports.target_region   IS 'Region the scam targets (vs region = where reported from)';
COMMENT ON COLUMN scam_reports.target_country  IS 'Country code the scam targets';

-- Indexes for financial/jurisdiction queries
CREATE INDEX IF NOT EXISTS idx_scam_reports_estimated_loss
  ON scam_reports (estimated_loss DESC)
  WHERE estimated_loss IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scam_reports_target_region
  ON scam_reports (target_region)
  WHERE target_region IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scam_reports_target_country
  ON scam_reports (target_country)
  WHERE target_country IS NOT NULL;

-- ============================================================
-- 2. VIEW: financial_impact_summary
--    Aggregates losses by date, scam_type, channel, region, currency.
-- ============================================================
CREATE OR REPLACE VIEW financial_impact_summary AS
SELECT
  sr.created_at::date                                              AS report_date,
  sr.scam_type,
  sr.channel,
  COALESCE(sr.target_region, sr.region)                            AS effective_region,
  COALESCE(sr.loss_currency, 'AUD')                                AS currency,
  COUNT(*)                                                         AS total_reports,
  COUNT(*) FILTER (WHERE sr.estimated_loss IS NOT NULL)             AS reports_with_loss,
  SUM(sr.estimated_loss)                                           AS total_loss,
  AVG(sr.estimated_loss)  FILTER (WHERE sr.estimated_loss IS NOT NULL) AS avg_loss,
  MAX(sr.estimated_loss)                                           AS max_loss,
  MIN(sr.estimated_loss)  FILTER (WHERE sr.estimated_loss > 0)     AS min_loss,
  COUNT(*) FILTER (WHERE sr.verdict = 'HIGH_RISK')                 AS high_risk_count,
  COUNT(*) FILTER (WHERE sr.verdict = 'SUSPICIOUS')                AS suspicious_count,
  COUNT(*) FILTER (WHERE sr.verdict = 'SAFE')                      AS safe_count,
  ARRAY_AGG(DISTINCT sr.impersonated_brand)
    FILTER (WHERE sr.impersonated_brand IS NOT NULL)                AS impersonated_brands
FROM scam_reports sr
GROUP BY
  sr.created_at::date,
  sr.scam_type,
  sr.channel,
  COALESCE(sr.target_region, sr.region),
  COALESCE(sr.loss_currency, 'AUD');

COMMENT ON VIEW financial_impact_summary IS
  'Aggregated financial impact by date, scam type, channel, region, and currency';

ALTER VIEW financial_impact_summary SET (security_invoker = true);

-- ============================================================
-- 3. RPC: record_financial_impact
--    Validates and updates a report with loss data.
-- ============================================================
CREATE OR REPLACE FUNCTION record_financial_impact(
  p_report_id      BIGINT,
  p_estimated_loss NUMERIC(12, 2),
  p_loss_currency  TEXT     DEFAULT 'AUD',
  p_target_region  TEXT     DEFAULT NULL,
  p_target_country TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Validate report exists
  SELECT EXISTS(SELECT 1 FROM scam_reports WHERE id = p_report_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN json_build_object(
      'success', FALSE,
      'error',   'report_not_found',
      'message', 'No scam report found with the given ID'
    )::JSONB;
  END IF;

  -- Validate loss is non-negative
  IF p_estimated_loss IS NOT NULL AND p_estimated_loss < 0 THEN
    RETURN json_build_object(
      'success', FALSE,
      'error',   'invalid_loss_amount',
      'message', 'Estimated loss cannot be negative'
    )::JSONB;
  END IF;

  -- Validate currency is 3-letter code
  IF p_loss_currency IS NOT NULL AND LENGTH(p_loss_currency) != 3 THEN
    RETURN json_build_object(
      'success', FALSE,
      'error',   'invalid_currency',
      'message', 'Currency must be a 3-letter ISO 4217 code'
    )::JSONB;
  END IF;

  -- Update
  UPDATE scam_reports
  SET estimated_loss  = p_estimated_loss,
      loss_currency   = COALESCE(p_loss_currency, 'AUD'),
      target_region   = p_target_region,
      target_country  = p_target_country
  WHERE id = p_report_id;

  RETURN json_build_object(
    'success',    TRUE,
    'report_id',  p_report_id,
    'message',    'Financial impact recorded successfully'
  )::JSONB;
END;
$$;

COMMENT ON FUNCTION record_financial_impact IS
  'Record or update financial loss data on a scam report';

-- ============================================================
-- 4. RPC: get_jurisdiction_summary
--    Per-region aggregates for state police coordination.
-- ============================================================
CREATE OR REPLACE FUNCTION get_jurisdiction_summary(
  p_date_from      TIMESTAMPTZ DEFAULT NULL,
  p_date_to        TIMESTAMPTZ DEFAULT NULL,
  p_target_country TEXT        DEFAULT NULL,
  p_min_reports    INT         DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_data), '[]'::JSONB)
  INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'effective_region',   COALESCE(sr.target_region, sr.region),
      'target_country',     sr.target_country,
      'total_reports',      COUNT(*),
      'high_risk_reports',  COUNT(*) FILTER (WHERE sr.verdict = 'HIGH_RISK'),
      'suspicious_reports', COUNT(*) FILTER (WHERE sr.verdict = 'SUSPICIOUS'),
      'reports_with_loss',  COUNT(*) FILTER (WHERE sr.estimated_loss IS NOT NULL),
      'total_loss',         COALESCE(SUM(sr.estimated_loss), 0),
      'avg_loss',           AVG(sr.estimated_loss) FILTER (WHERE sr.estimated_loss IS NOT NULL),
      'max_loss',           MAX(sr.estimated_loss),
      'scam_types',         ARRAY_AGG(DISTINCT sr.scam_type) FILTER (WHERE sr.scam_type IS NOT NULL),
      'brands',             ARRAY_AGG(DISTINCT sr.impersonated_brand) FILTER (WHERE sr.impersonated_brand IS NOT NULL),
      'channels',           ARRAY_AGG(DISTINCT sr.channel) FILTER (WHERE sr.channel IS NOT NULL),
      'earliest_report',    MIN(sr.created_at),
      'latest_report',      MAX(sr.created_at)
    ) AS row_data
    FROM scam_reports sr
    WHERE (p_date_from      IS NULL OR sr.created_at >= p_date_from)
      AND (p_date_to        IS NULL OR sr.created_at <= p_date_to)
      AND (p_target_country IS NULL OR sr.target_country = p_target_country)
    GROUP BY COALESCE(sr.target_region, sr.region), sr.target_country
    HAVING COUNT(*) >= p_min_reports
    ORDER BY COUNT(*) DESC
  ) sub;

  RETURN json_build_object(
    'date_from',      p_date_from,
    'date_to',        p_date_to,
    'target_country', p_target_country,
    'min_reports',    p_min_reports,
    'regions',        v_results
  )::JSONB;
END;
$$;

COMMENT ON FUNCTION get_jurisdiction_summary IS
  'Per-region aggregates for state police and jurisdiction coordination';

COMMIT;
