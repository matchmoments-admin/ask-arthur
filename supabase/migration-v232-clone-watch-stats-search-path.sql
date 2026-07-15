-- v232: clone-watch stats RPCs — harden search_path to '' (review fix)
--
-- v231 declared clone_watch_vendor_gap_stats and clone_watch_unactioned_age_stats
-- as SECURITY DEFINER with `SET search_path = public, pg_catalog`, following the
-- older v145/v215 pattern. The supabase/CLAUDE.md rule (and the dominant pattern
-- since v216, whose header explicitly frames the public,pg_catalog form as
-- superseded) is: SECURITY DEFINER functions use `SET search_path = ''` with
-- every reference fully qualified. Both bodies already qualify their one table
-- (public.shopfront_clone_alerts) and otherwise use only pg_catalog builtins
-- (percentile_cont / EXTRACT / now() / GREATEST / LEAST / interval), which
-- resolve under an empty path — so this is a pure posture fix, zero behaviour
-- change. Bodies below are byte-identical to v231 except the SET line.
--
-- Idempotent: CREATE OR REPLACE, signatures unchanged.

CREATE OR REPLACE FUNCTION public.clone_watch_vendor_gap_stats(p_days int DEFAULT 90)
RETURNS TABLE (
  window_days int,
  decline_to_weaponise_n bigint,
  decline_to_weaponise_median_hours int,
  weaponise_to_refile_n bigint,
  weaponise_to_refile_median_hours int,
  refile_to_takedown_n bigint,
  refile_to_takedown_median_hours int,
  full_loop_n bigint,
  full_loop_median_hours int,
  computed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  WITH bounds AS (
    SELECT GREATEST(1, LEAST(p_days, 365)) AS days,
           now() - (GREATEST(1, LEAST(p_days, 365)) * interval '1 day') AS since
  ),
  legs AS (
    SELECT
      sca.netcraft_declined_at,
      sca.weaponised_at,
      (sca.submitted_to->'netcraft_issue'->>'issue_reported_at')::timestamptz AS refiled_at,
      (sca.submitted_to->'netcraft'->>'submitted_at')::timestamptz AS submitted_at,
      (sca.submitted_to->'netcraft'->>'takedown_at')::timestamptz AS takedown_at
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
  )
  SELECT
    b.days AS window_days,
    COUNT(*) FILTER (WHERE l.netcraft_declined_at < l.weaponised_at
                       AND l.weaponised_at >= b.since)::bigint,
    (percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (l.weaponised_at - l.netcraft_declined_at)) / 3600.0
     ) FILTER (WHERE l.netcraft_declined_at < l.weaponised_at
                 AND l.weaponised_at >= b.since))::int,
    COUNT(*) FILTER (WHERE l.weaponised_at <= l.refiled_at
                       AND l.refiled_at >= b.since)::bigint,
    (percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (l.refiled_at - l.weaponised_at)) / 3600.0
     ) FILTER (WHERE l.weaponised_at <= l.refiled_at
                 AND l.refiled_at >= b.since))::int,
    COUNT(*) FILTER (WHERE l.refiled_at <= l.takedown_at
                       AND l.takedown_at >= b.since)::bigint,
    (percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (l.takedown_at - l.refiled_at)) / 3600.0
     ) FILTER (WHERE l.refiled_at <= l.takedown_at
                 AND l.takedown_at >= b.since))::int,
    COUNT(*) FILTER (WHERE l.submitted_at <= l.takedown_at
                       AND l.takedown_at >= b.since)::bigint,
    (percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (l.takedown_at - l.submitted_at)) / 3600.0
     ) FILTER (WHERE l.submitted_at <= l.takedown_at
                 AND l.takedown_at >= b.since))::int,
    now() AS computed_at
  -- LEFT JOIN ON TRUE (not CROSS JOIN): guarantees exactly one row even when
  -- no NRD alerts exist (counts 0, medians NULL) so callers never special-case
  -- an empty result set.
  FROM bounds b
  LEFT JOIN legs l ON TRUE
  GROUP BY b.days;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_vendor_gap_stats(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_vendor_gap_stats(int)
  TO service_role;

CREATE OR REPLACE FUNCTION public.clone_watch_unactioned_age_stats()
RETURNS TABLE (
  n bigint,
  median_days int,
  p90_days int,
  oldest_days int,
  computed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    COUNT(*)::bigint AS n,
    (percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (now() - sca.first_seen_at)) / 86400.0
     ))::int AS median_days,
    (percentile_cont(0.9) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (now() - sca.first_seen_at)) / 86400.0
     ))::int AS p90_days,
    (MAX(EXTRACT(EPOCH FROM (now() - sca.first_seen_at)) / 86400.0))::int AS oldest_days,
    now() AS computed_at
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state = 'declined'
    AND COALESCE(sca.urlscan_classification, '') <> 'unresolved';
$$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_unactioned_age_stats()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_unactioned_age_stats()
  TO service_role;
