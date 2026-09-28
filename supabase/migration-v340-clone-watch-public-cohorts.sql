-- migration-v340-clone-watch-public-cohorts.sql
--
-- PR-D of the map #1224 deepening plan: the three RPCs behind the public
-- /clone-watch impact panel count the populations the page says they count.
-- Every body below is re-created from its LIVE prod definition
-- (pg_get_functiondef, 2026-09-28), not from the last file on main. Signatures
-- and return shapes are unchanged, so CREATE OR REPLACE keeps each function's
-- OID and ACL; the REVOKE/GRANT is restated anyway (supabase/CLAUDE.md §7).
--
-- ── 1. "n=X of Y weaponised in window" was not a subset ─────────────────────
--
-- clone_watch_takedown_stats (v329) labels its detection→blocklist sample
-- against the weaponised cohort: the public tile reads
-- "n=<detect_to_block_n> of <weaponised_n> weaponised in window". But the
-- `detect` CTE windowed on the BLOCKLIST date only, while `cohort` windows on
-- weaponised_at. A clone weaponised 40 days ago and blocklisted 10 days ago
-- was in X and not in Y. Measured on 2026-09-28 (30-day window): the tile's
-- X was 11 and one of those 11 had been weaponised before the window, so the
-- page's "n=11 of 44" was really 10 of the 44 plus one from outside them.
-- Nothing stopped X exceeding Y. `detect` now also requires
-- weaponised_at >= since, so every row in X is a row of Y by construction
-- (n=10 of 44 on the same data).
-- Pinned by apps/web/__tests__/clonePublicCohortsSql.test.ts.
--
-- ── 2. Every public number is about confirmed lookalikes ─────────────────────
--
-- The page's list shows triage_status IN ('tp_confirmed','tp_actioned') and,
-- per the founder decision of 2026-09-28, says plainly that those are
-- confirmed lookalikes we report to blocklist providers. The takedown cohort
-- and the vendor-gap legs counted every NRD row with the right timestamps,
-- whatever its triage. On 2026-09-28 that put two rows nobody confirmed into
-- the published weaponised → re-file leg (n 107 → 105, median 735 h → 732 h):
-- one `pending` and one a human's `needs_investigation` deferral. All-time,
-- three weaponised rows are unconfirmed (one of them blocklisted, outside the
-- current 30-day window). Both RPCs now read only confirmed rows; the 30-day
-- takedown cohort is unchanged today (44, all tp_actioned). A weaponised clone the auto lane has not yet submitted
-- is still `pending` for up to a day (recordAutoSubmission stamps tp_actioned
-- at submit); it joins the cohort on its next read, which the panel's
-- "Updated daily" already implies.
--
-- ── 3. "Candidates surfaced" counted cleared false positives ─────────────────
--
-- clone_watch_public_impact.candidates_total was every NRD row in the window,
-- including rows triaged `fp` (14 of 840 on 2026-09-28). The tile is now
-- labelled "Brand-name matches" and excludes fp, the same membership rule as
-- the Clone Cohort (applyCohortRules, apps/web/lib/clone-watch/clone-cohort.ts).
-- The pre-classifier's is_clone=false rows are KEPT: that is an unreviewed
-- machine judgement whose false-negative rate the Not-a-clone Audit exists to
-- measure (v330), and the tile claims a name match, which they are. The
-- Netcraft / notification / brands columns are counted over the same rows, so
-- the page's "X of Y candidates forwarded" bar is a true subset too.
--
-- Also, per supabase/CLAUDE.md §4: search_path '' (two of the three were
-- 'public, pg_catalog' / SECURITY DEFINER) with every relation qualified, and
-- a function-level SET statement_timeout (in-body SET LOCAL is decorative
-- under PostgREST's 8 s). Read-only, STABLE, no table touched: safe to apply
-- before or after the code deploys.

-- ── clone_watch_public_impact ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clone_watch_public_impact(p_days integer DEFAULT 30)
 RETURNS TABLE(window_days integer, candidates_total bigint, tp_confirmed_total bigint, netcraft_submits_total bigint, brand_notifications_total bigint, brands_protected bigint, computed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  WITH window_rows AS (
    SELECT sca.triage_status, sca.submitted_to, sca.inferred_target_domain
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      AND sca.first_seen_at >= pg_catalog.now() - (GREATEST(1, LEAST(p_days, 90)) * interval '1 day')
      -- v340: a row cleared as a false positive is not a brand-name match we
      -- publish (the Clone Cohort's rule). IS DISTINCT FROM keeps NULL triage.
      AND sca.triage_status IS DISTINCT FROM 'fp'
  )
  SELECT
    GREATEST(1, LEAST(p_days, 90)) AS window_days,
    COUNT(*) AS candidates_total,
    COUNT(*) FILTER (WHERE triage_status IN ('tp_confirmed','tp_actioned')) AS tp_confirmed_total,
    COUNT(*) FILTER (WHERE submitted_to ? 'netcraft') AS netcraft_submits_total,
    COUNT(*) FILTER (WHERE submitted_to ? 'brand_notification') AS brand_notifications_total,
    -- Brands where we actively took action (submitted to Netcraft OR notified
    -- the brand). A row that was triaged TP but never acted on doesn't count.
    COUNT(DISTINCT inferred_target_domain) FILTER (
      WHERE submitted_to ? 'netcraft' OR submitted_to ? 'brand_notification'
    ) AS brands_protected,
    pg_catalog.now() AS computed_at
  FROM window_rows;
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_public_impact(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_public_impact(integer) TO service_role;

-- ── clone_watch_takedown_stats ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clone_watch_takedown_stats(p_days integer DEFAULT 30)
 RETURNS TABLE(window_days integer, takedowns_total bigint, median_minutes integer, p90_minutes integer, fastest_minutes integer, slowest_minutes integer, computed_at timestamp with time zone, timed_n bigint, detect_to_block_n bigint, detect_to_block_median_minutes integer, detect_to_block_p90_minutes integer, blocked_before_detection bigint, already_blocklisted_at_submit bigint, weaponised_n bigint, weaponised_blocklisted bigint, weaponised_offline bigint, weaponised_open bigint, weaponised_vendor_gap bigint, weaponised_escalated bigint, detect_to_offline_median_minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  WITH w AS (
    SELECT GREATEST(1, LEAST(p_days, 365)) AS days,
           pg_catalog.now() - (GREATEST(1, LEAST(p_days, 365)) * interval '1 day') AS since
  ),
  -- v340: the one population every figure below is drawn from — confirmed
  -- lookalikes, the rows the public list shows.
  confirmed AS (
    SELECT sca.*
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      AND sca.triage_status IN ('tp_confirmed', 'tp_actioned')
  ),
  blk AS (
    SELECT
      (sca.submitted_to -> 'netcraft' ->> 'takedown_at')::timestamptz          AS takedown_at,
      (sca.submitted_to -> 'netcraft' ->> 'takedown_received_at')::timestamptz AS received_at,
      sca.submitted_to -> 'netcraft' ->> 'takedown_at_source'                 AS src,
      sca.weaponised_at
    FROM confirmed sca, w
    WHERE (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NOT NULL
      AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at')::timestamptz >= w.since
  ),
  -- Both ends Netcraft's. >= guards a receipt later than the log date, which
  -- would only mean the two came from different submissions.
  triage AS (
    SELECT EXTRACT(EPOCH FROM (takedown_at - received_at)) / 60.0 AS m
    FROM blk
    WHERE src = 'netcraft_log' AND received_at IS NOT NULL AND takedown_at >= received_at
  ),
  -- Only vendor-dated stamps: a v219 witnessed stamp is our first LOOK, up to
  -- a reconcile cadence late, and would inflate the duration.
  -- v340: weaponised_at >= since, so the published "n=X of Y weaponised in
  -- window" is a subset of `cohort` by construction. A row blocked BEFORE we
  -- saw it phishing has weaponised_at > takedown_at >= since, so
  -- blocked_before_detection is unaffected by the new term.
  detect AS (
    SELECT EXTRACT(EPOCH FROM (blk.takedown_at - blk.weaponised_at)) / 60.0 AS m,
           blk.takedown_at >= blk.weaponised_at AS after_detection
    FROM blk, w
    WHERE blk.src = 'netcraft_log'
      AND blk.weaponised_at IS NOT NULL
      AND blk.weaponised_at >= w.since
  ),
  cohort AS (
    SELECT sca.*
    FROM confirmed sca, w
    WHERE sca.weaponised_at >= w.since
  )
  SELECT
    (SELECT days FROM w)::int,
    (SELECT count(*) FROM blk),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m))::int FROM triage),
    (SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY m))::int FROM triage),
    (SELECT round(min(m))::int FROM triage),
    (SELECT round(max(m))::int FROM triage),
    pg_catalog.now(),
    (SELECT count(*) FROM triage),
    (SELECT count(*) FROM detect WHERE after_detection),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m))::int FROM detect WHERE after_detection),
    (SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY m))::int FROM detect WHERE after_detection),
    (SELECT count(*) FROM detect WHERE NOT after_detection),
    (SELECT count(*)
       FROM confirmed sca, w
      WHERE COALESCE((sca.submitted_to -> 'netcraft' ->> 'already_malicious_at_submit')::boolean, false)
        AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz >= w.since),
    (SELECT count(*) FROM cohort),
    (SELECT count(*) FROM cohort WHERE lifecycle_state = 'taken_down'),
    (SELECT count(*) FROM cohort WHERE lifecycle_state = 'dormant' AND offline_since IS NOT NULL),
    (SELECT count(*) FROM cohort WHERE lifecycle_state = 'weaponised'),
    (SELECT count(*) FROM cohort
      WHERE lifecycle_state = 'weaponised'
        AND submitted_to -> 'netcraft' ->> 'url_state' IN ('no threats', 'unavailable')),
    (SELECT count(*) FROM cohort
      WHERE lifecycle_state = 'weaponised' AND COALESCE(submitted_to ? 'vendor_gap', false)),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (offline_since - weaponised_at)) / 60.0))::int
       FROM cohort
      WHERE lifecycle_state = 'dormant' AND offline_since IS NOT NULL
        AND offline_since >= weaponised_at);
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_takedown_stats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_takedown_stats(integer) TO service_role;

-- ── clone_watch_vendor_gap_stats ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clone_watch_vendor_gap_stats(p_days integer DEFAULT 90)
 RETURNS TABLE(window_days integer, decline_to_weaponise_n bigint, decline_to_weaponise_median_hours integer, weaponise_to_refile_n bigint, weaponise_to_refile_median_hours integer, refile_to_takedown_n bigint, refile_to_takedown_median_hours integer, full_loop_n bigint, full_loop_median_hours integer, computed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  WITH bounds AS (
    SELECT GREATEST(1, LEAST(p_days, 365)) AS days,
           pg_catalog.now() - (GREATEST(1, LEAST(p_days, 365)) * interval '1 day') AS since,
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
      -- v340: confirmed lookalikes only, the population the page lists.
      AND sca.triage_status IN ('tp_confirmed', 'tp_actioned')
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
    pg_catalog.now() AS computed_at
  -- LEFT JOIN ON TRUE (not CROSS JOIN): guarantees exactly one row even when
  -- no NRD alerts exist (counts 0, medians NULL) so callers never special-case
  -- an empty result set.
  FROM bounds b
  LEFT JOIN legs l ON TRUE
  GROUP BY b.days, b.decline_clock_trustworthy_since;
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_vendor_gap_stats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_vendor_gap_stats(integer) TO service_role;
