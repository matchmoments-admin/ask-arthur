-- v231: Clone-watch duration KPIs — the "vendor-gap clock" + unactioned-age
--
-- CONTEXT. The decline -> weaponise -> re-file -> takedown loop is fully closed
-- (v221 report_issue gate re-files weaponised clones; v217/v219 reconciler
-- witnesses takedowns) but never measured in DURATIONS. Every timestamp already
-- exists on shopfront_clone_alerts; these RPCs only aggregate them.
--
-- Semantics encoded here (the honesty rules):
--   * netcraft_declined_at is LAST-touch (re-stamped per decline) and can
--     postdate weaponised_at -> every leg carries a strict non-negative guard;
--     excluded pairs are simply not counted (the TS report module surfaces the
--     excluded_negative_n counter).
--   * weaponised_at is first-touch, quantised by the 6h recheck + 3h retrieve
--     crons -> hours, never minutes (false precision).
--   * submitted_to->'netcraft'->>'takedown_at' is witnessed-transition-only
--     (v219) -> takedown legs are automatically honest.
--   * submitted_to ? 'netcraft_issue' also marks SKIPS — the re-file signal is
--     specifically ...->>'issue_reported_at' IS NOT NULL.
--   * Medians are NULL when a leg has no rows (never COALESCE to 0 — a fake
--     "0h" published on /clone-watch would be worse than no number).
--
-- Grants follow the v160 posture: service-role only, aggregate-only output
-- rendered server-side on the public page (NOT the older v145 anon-grant).
--
-- Idempotent: CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS.

-- 1. The vendor-gap clock. One row of per-leg (n, median_hours) aggregates.
--    Window filter is on each leg's END event (a leg completes inside the
--    window regardless of when it started).
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
SET search_path = public, pg_catalog
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

COMMENT ON FUNCTION public.clone_watch_vendor_gap_stats(int) IS
  'The vendor-gap clock: per-leg (n, median hours) for decline->weaponise, weaponise->re-file (report_issue), re-file->takedown, and full submit->takedown loop. Aggregate-only output, published on /clone-watch (rendered server-side; service-role-only per v160 posture). Medians are NULL when a leg has no rows. NULL-comparison note: rows where either endpoint is NULL fail the strict < / <= predicates and are excluded automatically.';

-- 2. Unactioned-lookalike age. Point-in-time snapshot of the still-declined,
--    still-rendering tail ("declined & still live" = the unactioned attack
--    surface). NOT persisted to the monthly summary — it is a live number,
--    not a cohort fact. 'unresolved' (site did not render) is excluded from
--    "still live" honestly.
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
SET search_path = public, pg_catalog
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

COMMENT ON FUNCTION public.clone_watch_unactioned_age_stats() IS
  'Age distribution (median/p90/oldest days since first_seen_at) of the still-declined, still-rendering NRD tail — the unactioned attack surface. Live snapshot; deliberately not persisted to the monthly summary.';

-- 3. Additive summary columns (DEFAULT''d / nullable — no backfill UPDATE).
--    duration_kpis mirrors the mom/super_fund jsonb pattern (v189): the legs
--    will evolve, so jsonb beats 8 integer columns.
--    Shape: {"leg": {"n": int, "medianHours": int|null}, "excludedNegativeN": int, "asOf": iso}
ALTER TABLE public.clone_watch_report_summary
  ADD COLUMN IF NOT EXISTS duration_kpis jsonb;

COMMENT ON COLUMN public.clone_watch_report_summary.duration_kpis IS
  'Vendor-gap duration KPIs for the report month cohort (computed by the TS duration-kpis module — cohort-windowed on first_seen_at, so it is EXPECTED to differ from the rolling-event-window clone_watch_vendor_gap_stats RPC). Includes excludedNegativeN (pairs dropped by the last-touch netcraft_declined_at pathology).';

ALTER TABLE public.clone_watch_monthly_registrar_stats
  ADD COLUMN IF NOT EXISTS weaponised integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS median_days_to_weaponise real;

COMMENT ON COLUMN public.clone_watch_monthly_registrar_stats.median_days_to_weaponise IS
  'Median days first_seen_at -> weaponised_at for this registrar-month; NULL when the registrar had no weaponised clones that month.';
