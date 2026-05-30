-- v171: restore get_world_scam_stats. The v60 definition was never live in prod
-- (absent from pg_proc — either un-applied or dropped), so getWorldStats()
-- (apps/web/lib/dashboard/public-stats.ts) returned {} and the live /scam-map +
-- /about world maps rendered empty. The underlying tables (scam_entities,
-- scam_urls, feed_items) are all present with the columns it reads (verified by
-- dry-run: AU 8863 / US 16 / GB 2 / IN 2 over the last 30 days).
--
-- Hardened vs the original v60: SECURITY DEFINER + SET search_path = '' (all
-- refs schema-qualified) + REVOKE EXECUTE FROM PUBLIC, anon, authenticated +
-- GRANT service_role. The only caller is getWorldStats() via createServiceClient
-- (server-side), so anon never needs direct RPC access. Idempotent.

CREATE OR REPLACE FUNCTION public.get_world_scam_stats(days_back INT DEFAULT 30)
RETURNS TABLE (country_code TEXT, scam_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT country_code, SUM(cnt)::BIGINT AS scam_count
  FROM (
    SELECT country_code, COUNT(*) AS cnt
    FROM public.scam_entities
    WHERE country_code IS NOT NULL
      AND last_seen > now() - (days_back || ' days')::INTERVAL
    GROUP BY country_code
    UNION ALL
    SELECT country_code, COUNT(*) AS cnt
    FROM public.scam_urls
    WHERE country_code IS NOT NULL
      AND created_at > now() - (days_back || ' days')::INTERVAL
    GROUP BY country_code
    UNION ALL
    SELECT country_code, COUNT(*) AS cnt
    FROM public.feed_items
    WHERE country_code IS NOT NULL
      AND published = TRUE
      AND published_at > now() - (days_back || ' days')::INTERVAL
    GROUP BY country_code
  ) sub
  GROUP BY country_code
  ORDER BY scam_count DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_world_scam_stats(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_world_scam_stats(integer)
  TO service_role;

COMMENT ON FUNCTION public.get_world_scam_stats(integer) IS
  'Per-country scam counts over the last N days (scam_entities + scam_urls + feed_items). Backs the /scam-map + /about world maps via getWorldStats(). Restored v171 (v60 never live in prod).';
