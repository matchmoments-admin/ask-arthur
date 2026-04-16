-- Migration v58: Fraud manager search RPC.
-- Powers the fraud manager dashboard entity search feature.

CREATE OR REPLACE FUNCTION fraud_manager_search(
  p_query     TEXT,
  p_type      TEXT DEFAULT 'auto'
)
RETURNS TABLE (
  entity_value    TEXT,
  entity_type     TEXT,
  risk_score      INT,
  risk_level      TEXT,
  report_count    INT,
  first_seen      TIMESTAMPTZ,
  last_seen       TIMESTAMPTZ,
  scam_types      TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    se.normalized_value                AS entity_value,
    se.entity_type,
    se.risk_score,
    se.risk_level,
    se.report_count,
    se.first_seen,
    se.last_seen,
    ARRAY_AGG(DISTINCT sr.scam_type) FILTER (WHERE sr.scam_type IS NOT NULL) AS scam_types
  FROM scam_entities se
  LEFT JOIN report_entity_links rel ON rel.entity_id = se.id
  LEFT JOIN scam_reports sr ON sr.id = rel.report_id
  WHERE (
    p_type = 'auto' AND (
      se.normalized_value ILIKE '%' || p_query || '%'
      OR se.normalized_value = p_query
    )
  ) OR (
    p_type != 'auto' AND se.entity_type = p_type AND (
      se.normalized_value ILIKE '%' || p_query || '%'
      OR se.normalized_value = p_query
    )
  )
  GROUP BY se.id, se.normalized_value, se.entity_type, se.risk_score,
           se.risk_level, se.report_count, se.first_seen, se.last_seen
  ORDER BY se.risk_score DESC NULLS LAST, se.report_count DESC
  LIMIT 20;
$$;
