-- v60: RPC for world scam map — aggregates scam counts by country_code
-- Used by the WorldScamMap component on /scam-map and /about pages.

CREATE OR REPLACE FUNCTION get_world_scam_stats(days_back INT DEFAULT 30)
RETURNS TABLE (
  country_code TEXT,
  scam_count   BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT country_code, SUM(cnt)::BIGINT AS scam_count
  FROM (
    SELECT country_code, COUNT(*) AS cnt
    FROM scam_entities
    WHERE country_code IS NOT NULL
      AND last_seen > NOW() - (days_back || ' days')::INTERVAL
    GROUP BY country_code

    UNION ALL

    SELECT country_code, COUNT(*) AS cnt
    FROM scam_urls
    WHERE country_code IS NOT NULL
      AND created_at > NOW() - (days_back || ' days')::INTERVAL
    GROUP BY country_code

    UNION ALL

    SELECT country_code, COUNT(*) AS cnt
    FROM feed_items
    WHERE country_code IS NOT NULL
      AND published = TRUE
      AND published_at > NOW() - (days_back || ' days')::INTERVAL
    GROUP BY country_code
  ) sub
  GROUP BY country_code
  ORDER BY scam_count DESC;
$$;

GRANT EXECUTE ON FUNCTION get_world_scam_stats(INT) TO anon, authenticated;
