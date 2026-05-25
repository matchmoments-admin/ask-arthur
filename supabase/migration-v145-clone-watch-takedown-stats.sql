-- v145: Clone-watch — takedown stats RPC + selector for the polling cron.
--
-- Powers the median time-to-takedown KPI on the admin dashboard, weekly
-- Telegram digest, and LinkedIn-post draft. Phase B of the measurement
-- closure plan — see docs/plans/clone-watch-outreach.md §15.

-- 1. Selector for the Netcraft polling cron — alerts that have been
--    submitted but haven't yet recorded a takedown completion.
--    Returns up to p_limit rows, oldest pending first.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_poll(
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  netcraft_uuid text,
  candidate_url text,
  submitted_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    sca.id,
    (sca.submitted_to->'netcraft'->>'uuid')::text AS netcraft_uuid,
    sca.candidate_url,
    (sca.submitted_to->'netcraft'->>'submitted_at')::timestamptz AS submitted_at
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.submitted_to ? 'netcraft'
    AND (sca.submitted_to->'netcraft'->>'uuid') IS NOT NULL
    AND (sca.submitted_to->'netcraft'->>'takedown_at') IS NULL
    -- Don't keep polling indefinitely — give up after 30 days unresolved.
    AND (sca.submitted_to->'netcraft'->>'submitted_at')::timestamptz
        > now() - interval '30 days'
  ORDER BY (sca.submitted_to->'netcraft'->>'submitted_at')::timestamptz ASC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_poll(int)
  FROM anon, authenticated;

-- 2. Takedown stats — median + P90 time-to-takedown across the window.
--    Used by /admin/clone-watch + the weekly digest + the LinkedIn draft.
CREATE OR REPLACE FUNCTION public.clone_watch_takedown_stats(p_days int DEFAULT 30)
RETURNS TABLE (
  window_days int,
  takedowns_total bigint,
  median_minutes int,
  p90_minutes int,
  fastest_minutes int,
  slowest_minutes int,
  computed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  WITH takedown_rows AS (
    SELECT
      EXTRACT(EPOCH FROM (
        (submitted_to->'netcraft'->>'takedown_at')::timestamptz
        - (submitted_to->'netcraft'->>'submitted_at')::timestamptz
      )) / 60.0 AS duration_minutes
    FROM public.shopfront_clone_alerts
    WHERE source = 'nrd'
      AND submitted_to ? 'netcraft'
      AND (submitted_to->'netcraft'->>'takedown_at') IS NOT NULL
      AND (submitted_to->'netcraft'->>'submitted_at')::timestamptz
          >= now() - (GREATEST(1, LEAST(p_days, 365)) * interval '1 day')
  )
  SELECT
    GREATEST(1, LEAST(p_days, 365)) AS window_days,
    COUNT(*)::bigint AS takedowns_total,
    -- COALESCE to 0 when no rows so the dashboard renders cleanly
    COALESCE(
      percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_minutes)::int,
      0
    ) AS median_minutes,
    COALESCE(
      percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_minutes)::int,
      0
    ) AS p90_minutes,
    COALESCE(MIN(duration_minutes)::int, 0) AS fastest_minutes,
    COALESCE(MAX(duration_minutes)::int, 0) AS slowest_minutes,
    now() AS computed_at
  FROM takedown_rows;
$$;

-- Anon-callable so the public /clone-watch impact block can include median
-- time-to-takedown without service-role. The output is aggregate-only.
GRANT EXECUTE ON FUNCTION public.clone_watch_takedown_stats(int)
  TO anon, authenticated;

COMMENT ON FUNCTION public.clone_watch_takedown_stats(int) IS
  'Aggregate Netcraft takedown latency stats (median + P90 + min/max). Aggregate-only output; safe for anon-callable use on the public /clone-watch impact section.';
