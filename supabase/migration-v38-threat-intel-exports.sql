-- Migration v38: Threat Intelligence Export Views
-- Adds 4 SQL views + 1 RPC for government/law-enforcement reporting exports.
-- No new tables — purely additive, read-only layer on existing data.

BEGIN;

-- ============================================================
-- 1. threat_intel_entities
--    High-value entities (report_count >= 2 OR risk HIGH/CRITICAL)
--    with linked report aggregates.
-- ============================================================
CREATE OR REPLACE VIEW threat_intel_entities AS
SELECT
  se.id                     AS entity_id,
  se.entity_type,
  se.normalized_value,
  se.risk_score,
  se.risk_level,
  se.risk_factors,
  se.report_count,
  se.first_seen,
  se.last_seen,
  se.enrichment_data,
  se.feed_sources,
  COUNT(DISTINCT rel.report_id)                          AS linked_report_count,
  COUNT(DISTINCT sr.scam_type)   FILTER (WHERE sr.scam_type IS NOT NULL)  AS distinct_scam_types,
  ARRAY_AGG(DISTINCT sr.scam_type)   FILTER (WHERE sr.scam_type IS NOT NULL)  AS scam_types,
  ARRAY_AGG(DISTINCT sr.channel)     FILTER (WHERE sr.channel IS NOT NULL)    AS channels,
  ARRAY_AGG(DISTINCT sr.impersonated_brand)
    FILTER (WHERE sr.impersonated_brand IS NOT NULL)     AS impersonated_brands,
  ARRAY_AGG(DISTINCT sr.verdict)                         AS verdicts,
  MIN(sr.created_at)                                     AS earliest_report,
  MAX(sr.created_at)                                     AS latest_report
FROM scam_entities se
LEFT JOIN report_entity_links rel ON rel.entity_id = se.id
LEFT JOIN scam_reports sr         ON sr.id = rel.report_id
WHERE se.report_count >= 2
   OR se.risk_level IN ('HIGH', 'CRITICAL')
GROUP BY se.id;

COMMENT ON VIEW threat_intel_entities IS
  'High-value entities for government / law-enforcement threat intel exports';

ALTER VIEW threat_intel_entities SET (security_invoker = true);

-- ============================================================
-- 2. threat_intel_urls
--    Active, high-confidence or frequently reported URLs for blocklist feeds.
-- ============================================================
CREATE OR REPLACE VIEW threat_intel_urls AS
SELECT
  su.id               AS url_id,
  su.normalized_url,
  su.domain,
  su.subdomain,
  su.tld,
  su.full_path,
  su.report_count,
  su.unique_reporter_count,
  su.confidence_score,
  su.confidence_level,
  su.primary_scam_type,
  su.brand_impersonated,
  su.google_safe_browsing,
  su.virustotal_malicious,
  su.virustotal_score,
  su.whois_registrar,
  su.whois_registrant_country,
  su.whois_created_date,
  su.whois_is_private,
  su.ssl_valid,
  su.ssl_issuer,
  su.ssl_days_remaining,
  su.feed_sources,
  su.first_reported_at,
  su.last_reported_at,
  su.is_active
FROM scam_urls su
WHERE su.is_active = TRUE
  AND (su.confidence_level IN ('high', 'confirmed') OR su.report_count >= 3);

COMMENT ON VIEW threat_intel_urls IS
  'Active, high-confidence URLs for government blocklist / takedown feeds';

ALTER VIEW threat_intel_urls SET (security_invoker = true);

-- ============================================================
-- 3. threat_intel_daily_summary
--    Daily trends by region for government dashboards.
-- ============================================================
CREATE OR REPLACE VIEW threat_intel_daily_summary AS
SELECT
  cs.date,
  cs.region,
  cs.total_checks,
  cs.safe_count,
  cs.suspicious_count,
  cs.high_risk_count,
  COALESCE(rpt.report_count, 0)                                   AS scam_reports_count,
  COALESCE(rpt.distinct_scam_types, 0)                             AS distinct_scam_types,
  rpt.top_scam_types,
  rpt.top_brands
FROM check_stats cs
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                                        AS report_count,
    COUNT(DISTINCT sr.scam_type) FILTER (WHERE sr.scam_type IS NOT NULL) AS distinct_scam_types,
    ARRAY_AGG(DISTINCT sr.scam_type)  FILTER (WHERE sr.scam_type IS NOT NULL) AS top_scam_types,
    ARRAY_AGG(DISTINCT sr.impersonated_brand)
      FILTER (WHERE sr.impersonated_brand IS NOT NULL)              AS top_brands
  FROM scam_reports sr
  WHERE sr.created_at::date = cs.date
    AND (cs.region IS NULL OR sr.region = cs.region)
) rpt ON TRUE;

COMMENT ON VIEW threat_intel_daily_summary IS
  'Daily check/report trends by region for government dashboards';

ALTER VIEW threat_intel_daily_summary SET (security_invoker = true);

-- ============================================================
-- 4. threat_intel_scam_campaigns
--    Campaign-level reporting with entity lists.
-- ============================================================
CREATE OR REPLACE VIEW threat_intel_scam_campaigns AS
SELECT
  sc.id                  AS cluster_id,
  sc.cluster_type,
  sc.primary_scam_type,
  sc.primary_brand,
  sc.member_count,
  sc.entity_count,
  sc.total_loss,
  sc.status,
  sc.metadata,
  sc.first_seen,
  sc.last_seen,
  COALESCE(ent.entity_list, '[]'::JSONB)  AS entities
FROM scam_clusters sc
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'entity_id',        se.id,
      'entity_type',      se.entity_type,
      'normalized_value', se.normalized_value,
      'risk_level',       se.risk_level,
      'report_count',     se.report_count
    )
  ) AS entity_list
  FROM cluster_members cm
  JOIN scam_reports sr          ON sr.id = cm.report_id
  JOIN report_entity_links rel  ON rel.report_id = sr.id
  JOIN scam_entities se         ON se.id = rel.entity_id
  WHERE cm.cluster_id = sc.id
) ent ON TRUE;

COMMENT ON VIEW threat_intel_scam_campaigns IS
  'Campaign-level cluster reporting with linked entity lists';

ALTER VIEW threat_intel_scam_campaigns SET (security_invoker = true);

-- ============================================================
-- 5. RPC: get_threat_intel_export
--    Paginated, filterable entity export returning JSON with metadata.
-- ============================================================
CREATE OR REPLACE FUNCTION get_threat_intel_export(
  p_entity_type  TEXT     DEFAULT NULL,
  p_risk_level   TEXT     DEFAULT NULL,
  p_date_from    TIMESTAMPTZ DEFAULT NULL,
  p_date_to      TIMESTAMPTZ DEFAULT NULL,
  p_scam_type    TEXT     DEFAULT NULL,
  p_limit        INT      DEFAULT 100,
  p_offset       INT      DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   BIGINT;
  v_results JSONB;
BEGIN
  -- Count matching entities
  SELECT COUNT(DISTINCT se.id)
  INTO v_total
  FROM scam_entities se
  LEFT JOIN report_entity_links rel ON rel.entity_id = se.id
  LEFT JOIN scam_reports sr         ON sr.id = rel.report_id
  WHERE (se.report_count >= 2 OR se.risk_level IN ('HIGH', 'CRITICAL'))
    AND (p_entity_type IS NULL OR se.entity_type = p_entity_type)
    AND (p_risk_level  IS NULL OR se.risk_level  = p_risk_level)
    AND (p_date_from   IS NULL OR se.last_seen  >= p_date_from)
    AND (p_date_to     IS NULL OR se.first_seen <= p_date_to)
    AND (p_scam_type   IS NULL OR sr.scam_type   = p_scam_type);

  -- Fetch paginated rows
  SELECT COALESCE(jsonb_agg(row_data), '[]'::JSONB)
  INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'entity_id',          se.id,
      'entity_type',        se.entity_type,
      'normalized_value',   se.normalized_value,
      'risk_score',         se.risk_score,
      'risk_level',         se.risk_level,
      'risk_factors',       se.risk_factors,
      'report_count',       se.report_count,
      'first_seen',         se.first_seen,
      'last_seen',          se.last_seen,
      'enrichment_data',    se.enrichment_data,
      'feed_sources',       se.feed_sources,
      'linked_reports',     COUNT(DISTINCT rel.report_id),
      'scam_types',         ARRAY_AGG(DISTINCT sr.scam_type) FILTER (WHERE sr.scam_type IS NOT NULL),
      'brands',             ARRAY_AGG(DISTINCT sr.impersonated_brand) FILTER (WHERE sr.impersonated_brand IS NOT NULL),
      'verdicts',           ARRAY_AGG(DISTINCT sr.verdict)
    ) AS row_data
    FROM scam_entities se
    LEFT JOIN report_entity_links rel ON rel.entity_id = se.id
    LEFT JOIN scam_reports sr         ON sr.id = rel.report_id
    WHERE (se.report_count >= 2 OR se.risk_level IN ('HIGH', 'CRITICAL'))
      AND (p_entity_type IS NULL OR se.entity_type = p_entity_type)
      AND (p_risk_level  IS NULL OR se.risk_level  = p_risk_level)
      AND (p_date_from   IS NULL OR se.last_seen  >= p_date_from)
      AND (p_date_to     IS NULL OR se.first_seen <= p_date_to)
      AND (p_scam_type   IS NULL OR sr.scam_type   = p_scam_type)
    GROUP BY se.id
    ORDER BY se.risk_score DESC, se.report_count DESC
    LIMIT  p_limit
    OFFSET p_offset
  ) sub;

  RETURN json_build_object(
    'total_count', v_total,
    'limit',       p_limit,
    'offset',      p_offset,
    'data',        v_results
  )::JSONB;
END;
$$;

COMMENT ON FUNCTION get_threat_intel_export IS
  'Paginated, filterable entity export for government threat intel feeds';

COMMIT;
