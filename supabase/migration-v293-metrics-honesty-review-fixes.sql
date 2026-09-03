-- v293: review fixes to v292's two honesty metrics (#1071, map #1060).
--
-- v292 was reviewed after being applied; four defects, each verified against
-- prod before this migration was written.
--
-- 1. THE CUT-OVER DATE WAS WRONG, AND IT IS PUBLISHED. v292 bounded the
--    decline→weaponise leg at '2026-08-09T00:00:00Z', but v273 — the migration
--    that stopped `advance_clone_lifecycle` re-stamping netcraft_declined_at —
--    was applied at **21:31 UTC that day** (its own header records the time).
--    Every decline stamped in those 21.5 hours is still a re-stamped,
--    compression-biased value, and with a 6h recheck cadence essentially all of
--    them were re-stamped repeatedly. Measured now: 3 of the 27 pairs v292
--    admits come from that window, and because the bias is one-directional they
--    drag the PUBLIC /clone-watch median from an honest 23h down to 17h. Bound
--    moved to the real apply instant. n=27→24, median 17h→23h.
--
-- 2. THE RULE WAS APPLIED TO ONE LEG OF THREE. v292's own header states it —
--    "a stranded leg's predicate must EXCLUDE every shape some lane still
--    retries" — then carved out only `is_submitted_no_uuid`. `is_streak_frozen`
--    kept counting rows that `list_clone_alerts_for_recheck` (v277) rescans
--    every 6h: that lane has NO streak and NO uuid predicate and its header
--    calls itself the only lane that can rescue a streak-frozen row. Terminal
--    rows (taken_down / weaponised) were counted too, though v292's header says
--    they "left the problem". Zero such rows exist today, so this is the fourth
--    regression of this metric caught BEFORE it printed a wrong number rather
--    than after. Both carve-outs now applied to that leg.
--
-- 3. THE 400-CARVE-OUTS WERE NOT NULL-SAFE. `NOT (evidence->>'status' = '400'
--    AND first_seen_at >= …)` evaluates to NULL — not TRUE — when the evidence
--    carries no status, so the FILTER silently DROPS the row. Rows with a null
--    status are reachable: `serialiseSubmitFailure` writes `status:
--    submission.status ?? null` on any network error or timeout. The effect is
--    the honesty metric under-reporting genuinely stranded rows — the opposite
--    error from #1 and #2, in the same function. v285 already uses the safe
--    form; mirrored here as `IS DISTINCT FROM '400'`.
--
-- 4. THE SUBMIT-LANE CARVE-OUT MATCHED ONLY HALF THAT LANE'S PREDICATE. v285
--    re-admits a uuid-less row when `status='400'` OR `failure_streak < cap`,
--    inside the 90-day horizon. v292 excluded only the first arm, so a legacy
--    row with a 5xx/timeout status and a streak under the cap is actively
--    retried every day while being counted as "no lane will retry". Second arm
--    added.
--
-- Also corrected: v292's header explained the declined-tail rows as "rescan
-- attempts got a 400 which stamps urlscan_submitted_at without a uuid". That
-- mechanism has not existed since v272 — `record_clone_alert_urlscan_submit`,
-- the sole writer of that column, stamps it only when a uuid comes back. Those
-- rows are pre-v272 residue. The carve-out stands on the recheck-lane
-- predicate; only the stated reason was wrong, and a wrong stated reason is
-- what the next regression gets judged against.
--
-- Idempotent (CREATE OR REPLACE + grants restated). Reverse = re-apply v292.

BEGIN;

-- ── 1. stranded count: every leg, NULL-safe, terminal states excluded ───────

CREATE OR REPLACE FUNCTION public.clone_watch_urlscan_stranded_count(
  p_max_failure_streak integer DEFAULT 3
)
RETURNS TABLE (
  stranded_total bigint,
  stranded_streak bigint,
  stranded_submitted_no_uuid bigint,
  stranded_uuid_no_submitted_at bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH scoped AS (
    SELECT
      sca.*,
      -- Shapes some lane still retries, factored out so all three legs agree
      -- on them. Divergence between the legs is what produced v286's and
      -- v292's partial fixes.
      (sca.lifecycle_state IN ('monitoring', 'declined')
        AND sca.first_seen_at >= now() - interval '90 days')  AS recheck_lane_retries,
      (sca.urlscan_uuid IS NULL
        AND sca.first_seen_at >= now() - interval '90 days'
        AND (
          sca.urlscan_evidence ->> 'status' IS NOT DISTINCT FROM '400'
          OR sca.urlscan_failure_streak < p_max_failure_streak
        ))                                                    AS submit_lane_retries,
      (sca.lifecycle_state IN ('taken_down', 'weaponised'))   AS terminal
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      -- Deliberate, recorded retirement is not "stuck and we don't know it".
      AND sca.lifecycle_state <> 'dormant'
  ),
  flagged AS (
    SELECT
      s.*,
      (s.urlscan_failure_streak >= p_max_failure_streak
        AND s.urlscan_classification IS NULL
        AND NOT s.recheck_lane_retries
        AND NOT s.submit_lane_retries
        AND NOT s.terminal)                       AS is_streak_frozen,
      (s.urlscan_submitted_at IS NOT NULL
        AND s.urlscan_uuid IS NULL
        AND s.urlscan_scanned_at IS NULL
        AND NOT s.recheck_lane_retries
        AND NOT s.submit_lane_retries
        AND NOT s.terminal)                       AS is_submitted_no_uuid,
      (s.urlscan_uuid IS NOT NULL
        AND s.urlscan_submitted_at IS NULL
        AND s.urlscan_classification IS NULL
        AND NOT s.recheck_lane_retries
        AND NOT s.terminal)                       AS is_uuid_no_submitted_at
    FROM scoped s
  )
  SELECT
    -- The union. Render THIS; the three below are an overlapping breakdown.
    count(*) FILTER (
      WHERE f.is_streak_frozen
         OR f.is_submitted_no_uuid
         OR f.is_uuid_no_submitted_at
    ),
    count(*) FILTER (WHERE f.is_streak_frozen),
    count(*) FILTER (WHERE f.is_submitted_no_uuid),
    count(*) FILTER (WHERE f.is_uuid_no_submitted_at)
  FROM flagged f;
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  TO service_role;

COMMENT ON FUNCTION public.clone_watch_urlscan_stranded_count(integer) IS
  'Clone-watch alerts that no automated lane will retry, as a UNION (v274) plus an overlapping three-way breakdown — never sum them; render stranded_total. v293: the retry shapes (recheck lane v277, submit lane v285, terminal states) are factored out ONCE and applied to all three legs, NULL-safely. Fourth iteration of this metric; every prior regression was a leg that disagreed with a widened worklist.';

-- ── 2. vendor-gap: bound the decline clock at v273's real apply instant ─────

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
           now() - (GREATEST(1, LEAST(p_days, 365)) * interval '1 day') AS since,
           -- v273's MEASURED apply instant, not midnight of that day (v292's
           -- error). Declines stamped before this are re-stamped values that
           -- measure the 6h recheck cadence, not the vendor gap, and the bias
           -- is one-directional so even a few drag the published median down.
           '2026-08-09T21:31:00Z'::timestamptz AS decline_clock_trustworthy_since
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
                       AND l.netcraft_declined_at >= b.decline_clock_trustworthy_since
                       AND l.weaponised_at >= b.since)::bigint,
    (percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (l.weaponised_at - l.netcraft_declined_at)) / 3600.0
     ) FILTER (WHERE l.netcraft_declined_at < l.weaponised_at
                 AND l.netcraft_declined_at >= b.decline_clock_trustworthy_since
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
  GROUP BY b.days, b.decline_clock_trustworthy_since;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_vendor_gap_stats(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_vendor_gap_stats(int)
  TO service_role;

COMMENT ON FUNCTION public.clone_watch_vendor_gap_stats(int) IS
  'Rolling-window duration legs for the vendor-gap clock (public /clone-watch strip + admin report card). v293: the decline→weaponise leg admits only pairs whose netcraft_declined_at is at/after v273''s real apply instant 2026-08-09T21:31Z — v292 used midnight and let 21.5h of re-stamped values into the published median.';

COMMIT;
