-- v292: two lying clone-watch metrics (#1071, wayfinder map #1060).
--
-- LIAR 1 — clone_watch_urlscan_stranded_count returned 286 where the true
-- "no automated lane will retry this" count is ~2. The v286 fix carved the
-- 400-in-horizon rows out of the `stranded_streak` leg but NOT out of
-- `stranded_submitted_no_uuid`, and the union counts them. Empirically
-- (2026-09-02): 263 of the counted rows are `declined` within the 90-day
-- recheck horizon — the v277 recheck lane actively cycles them (184 rechecked
-- within the last 7 days, 40 within 2 days; their rescan-submit attempts got
-- a 400 which stamps urlscan_submitted_at without a uuid, which is exactly
-- this leg's shape). 22 more are `taken_down` — past the classification
-- problem entirely. Third regression of the same metric (v274: 75%
-- overstatement; v286: 95%; this: ~99%).
--
-- The rule, again, wider: a "stranded" leg's predicate must EXCLUDE every
-- shape some lane still retries —
--   * submit lane (v285): status-400 rows inside the 90-day submit horizon
--     retry on the dead-domain cadence;
--   * recheck lane (v277): monitoring/declined rows inside the 90-day recheck
--     horizon retry on the 6h/168h cadences regardless of streak or uuid;
--   * terminal states (taken_down, weaponised): nothing needs to classify
--     them — they left the problem, they are not stuck in it.
--
-- LIAR 2 — clone_watch_vendor_gap_stats' decline→weaponise leg. Until v273
-- (applied 2026-08-09), advance_clone_lifecycle re-stamped
-- netcraft_declined_at to now() on every no-op recheck, compressing the leg
-- one-directionally toward the 6h recheck cadence; the original stamps were
-- overwritten and are unrecoverable. The 2026-08-09 correction quarantined
-- the leg "ops appendix only until ~October", but the public /clone-watch
-- vendor-gap strip kept rendering it — live today: "median 2h … from a
-- vendor 'no threats found' grading to … live phishing (n=59)". Fix at the
-- source, not the renderer: only pairs whose decline stamp is post-v273 can
-- enter ANY window. Verified on apply (2026-09-02): n=59/median 2h became
-- n=27/median 17h — enough clean pairs already exist to render an honest
-- median. The constant becomes a no-op once every windowed pair is post-v273.
--
-- Idempotent (CREATE OR REPLACE, grants restated). No reverse script needed —
-- reverse = re-apply v286/v232's definitions.

BEGIN;

-- ── 1. stranded count: carve every still-retried shape out of the
--       submitted-no-uuid leg (and therefore the union) ──────────────────────

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
      -- v286: v285 re-admits a 400 (no DNS) inside the submit horizon
      -- regardless of streak, so such a row is NOT stranded — the lane retries
      -- it on the dead-domain cadence. Past the horizon it is stranded again,
      -- until the dormant sweep records that we gave up.
      (sca.urlscan_failure_streak >= p_max_failure_streak
        AND sca.urlscan_classification IS NULL
        AND NOT (
          sca.urlscan_evidence ->> 'status' = '400'
          AND sca.first_seen_at >= now() - interval '90 days'
        )) AS is_streak_frozen,
      -- v292: same carve-outs this leg always needed. A rescan attempt that
      -- 400s stamps urlscan_submitted_at with no uuid — the recheck lane
      -- (v277) retries monitoring/declined rows inside its 90-day horizon on
      -- the 6h/168h cadences, and the submit lane (v285) retries 400s inside
      -- the same horizon. Terminal rows left the classification problem.
      (sca.urlscan_submitted_at IS NOT NULL
        AND sca.urlscan_uuid IS NULL
        AND sca.urlscan_scanned_at IS NULL
        AND NOT (
          sca.lifecycle_state IN ('monitoring', 'declined')
          AND sca.first_seen_at >= now() - interval '90 days'
        )
        AND NOT (
          sca.urlscan_evidence ->> 'status' = '400'
          AND sca.first_seen_at >= now() - interval '90 days'
        )
        AND sca.lifecycle_state NOT IN ('taken_down', 'weaponised')
      ) AS is_submitted_no_uuid,
      (sca.urlscan_uuid IS NOT NULL
        AND sca.urlscan_submitted_at IS NULL
        AND sca.urlscan_classification IS NULL) AS is_uuid_no_submitted_at
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      -- Deliberate, recorded retirement is not "stuck and we don't know it".
      AND sca.lifecycle_state <> 'dormant'
  )
  SELECT
    -- The union. Render THIS; the three below are an overlapping breakdown.
    count(*) FILTER (
      WHERE s.is_streak_frozen
         OR s.is_submitted_no_uuid
         OR s.is_uuid_no_submitted_at
    ),
    count(*) FILTER (WHERE s.is_streak_frozen),
    count(*) FILTER (WHERE s.is_submitted_no_uuid),
    count(*) FILTER (WHERE s.is_uuid_no_submitted_at)
  FROM scoped s;
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  TO service_role;

COMMENT ON FUNCTION public.clone_watch_urlscan_stranded_count(integer) IS
  'Clone-watch alerts that no automated lane will retry, as a UNION (v274) plus an overlapping three-way breakdown. The three shapes overlap heavily — never sum them; render stranded_total. v292: the submitted-no-uuid leg now excludes rows the v277 recheck lane or v285 submit lane still retries, and terminal (taken_down/weaponised) rows — third regression of this metric, always the same bug: a widened worklist must be mirrored here.';

-- ── 2. vendor-gap stats: only post-v273 decline stamps can form the
--       decline→weaponise leg ────────────────────────────────────────────────

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
           -- v273 (applied 2026-08-09) stopped advance_clone_lifecycle
           -- re-stamping netcraft_declined_at on no-op rechecks. Every stamp
           -- before that date is one-directionally compressed toward the 6h
           -- recheck cadence and the original is unrecoverable — so pre-v273
           -- stamps must never form a decline→weaponise pair, in ANY window.
           '2026-08-09T00:00:00Z'::timestamptz AS decline_clock_trustworthy_since
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
  'Rolling-window duration legs for the vendor-gap clock (public /clone-watch strip + admin report card). v292: the decline→weaponise leg only admits pairs whose netcraft_declined_at is post-v273 (2026-08-09) — earlier stamps were re-stamped by no-op rechecks and measure the recheck cadence, not the vendor gap.';

COMMIT;
