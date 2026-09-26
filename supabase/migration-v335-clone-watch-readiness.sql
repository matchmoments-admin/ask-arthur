-- migration-v335-clone-watch-readiness.sql — the Clone Watch readiness
-- scorecard (#1237, map #1224; founder decision #1227).
--
-- WHY. Founder decision 2026-09-26: no brand is contacted until Clone Watch is
-- stable AND accurate — measured, holding for consecutive months — and even
-- then only in shadow until the #371 legal sign-off. "Stable and accurate" was
-- a sentence; this migration gives it a row. One row per closed month, seven
-- components, each with its value, sample n, the threshold in force when it was
-- computed, and pass / fail / insufficient. The stewardship and brand-notify
-- SEND paths refuse a real send unless the last READINESS_REQUIRED_MONTHS
-- closed months all read ready = true (apps/web/lib/clone-watch/readiness.ts).
--
-- Nothing here is new measurement. Every component reads an existing source:
--   precision / fp_share  shopfront_clone_alerts human triage verdicts
--   fn_rate               clone_watch_not_a_clone_audit_summary() (v330)
--   lane_health           alert_delivery_log rows of the daily health-digest
--                         (metadata.lane_problems, written since 2026-09-18)
--   report_diff           clone_watch_monthly_brand_stats (frozen) vs a live
--                         recount through the same fold (TypeScript)
--   takedown              clone_watch_takedown_stats() (v329)
--   stock                 clone_liveness_runs (v325)
--
-- Objects:
--   1. clone_watch_readiness — the scorecard. Written ONCE a month by
--      clone-watch-report-summary (1st, 11:00 UTC) in its own step, and on
--      demand by that function's existing manual trigger. Upsert on
--      period_month: a recompute replaces the month's row (the scorecard is a
--      measurement of now, not a published edition — the frozen store is).
--      CHECK ready_iff_all_pass: `ready` is true exactly when all seven
--      statuses are 'pass', so no writer can mark a month ready while a
--      component failed or had insufficient data.
--   2. clone_watch_readiness_inputs(p_start, p_end) — the SQL-side inputs
--      (triage verdicts, classifier context, lane-health days) for one window,
--      as one jsonb. NULL-honest: a day with no health-digest row, or a row
--      predating the lane_problems key, is NOT measured — never a clean day.
--
-- Human verdicts: triage_status tp_confirmed / fp / needs_investigation set
-- through the admin triage route. Machine writers are excluded by their note
-- markers — `auto-park:` (pre-classifier park), `auto-triage:` (retired #1257,
-- wrote 0 verdicts) and `[matcher-v4-audit]` (the 2026-09-04 bulk re-label of
-- 466 alerts by a matcher rule, not a per-alert verdict). triage_by is NULL for
-- every row in prod (HMAC admin), so the note marker is the only discriminator;
-- a new machine writer MUST use a marker and be added to the list below.
--
-- Security (supabase/CLAUDE.md §7, v324): RLS on, no policies (deny-all for
-- anon/authenticated), explicit REVOKE from anon/authenticated, service_role
-- only. The function is SECURITY DEFINER + search_path '' + fully-qualified
-- names, REVOKE FROM PUBLIC, anon, authenticated; EXECUTE to service_role.
-- Function-level statement_timeout (§4 — an in-body SET LOCAL is decorative).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP CONSTRAINT IF
-- EXISTS before ADD. Cold table (12 rows/year). Rollback: DROP FUNCTION
-- clone_watch_readiness_inputs(timestamptz, timestamptz); DROP TABLE
-- clone_watch_readiness — nothing else reads either, and with the table gone
-- the send gate reads "unreadable" and fails CLOSED (shadow only).

BEGIN;

-- ── 1. The scorecard ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clone_watch_readiness (
  period_month           date PRIMARY KEY
                         CHECK (period_month = date_trunc('month', period_month)::date),

  precision_value        numeric,
  precision_n            integer,
  precision_threshold    numeric NOT NULL,
  precision_status       text NOT NULL
                         CHECK (precision_status IN ('pass', 'fail', 'insufficient')),

  fp_share_value         numeric,
  fp_share_n             integer,
  fp_share_threshold     numeric NOT NULL,
  fp_share_status        text NOT NULL
                         CHECK (fp_share_status IN ('pass', 'fail', 'insufficient')),

  fn_rate_value          numeric,
  fn_rate_n              integer,
  fn_rate_threshold      numeric NOT NULL,
  fn_rate_status         text NOT NULL
                         CHECK (fn_rate_status IN ('pass', 'fail', 'insufficient')),

  lane_health_value      numeric,
  lane_health_n          integer,
  lane_health_threshold  numeric NOT NULL,
  lane_health_status     text NOT NULL
                         CHECK (lane_health_status IN ('pass', 'fail', 'insufficient')),

  report_diff_value      numeric,
  report_diff_n          integer,
  report_diff_threshold  numeric NOT NULL,
  report_diff_status     text NOT NULL
                         CHECK (report_diff_status IN ('pass', 'fail', 'insufficient')),

  takedown_value         numeric,
  takedown_n             integer,
  takedown_threshold     numeric NOT NULL,
  takedown_status        text NOT NULL
                         CHECK (takedown_status IN ('pass', 'fail', 'insufficient')),

  stock_value            numeric,
  stock_n                integer,
  stock_threshold        numeric NOT NULL,
  stock_status           text NOT NULL
                         CHECK (stock_status IN ('pass', 'fail', 'insufficient')),

  ready                  boolean NOT NULL,
  -- Per component: the reason line the admin page shows, secondary thresholds
  -- (minimum n, share caps) and context figures. Display only — the gate reads
  -- `ready`, never this.
  detail                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clone_watch_readiness
  DROP CONSTRAINT IF EXISTS clone_watch_readiness_ready_iff_all_pass;
ALTER TABLE public.clone_watch_readiness
  ADD CONSTRAINT clone_watch_readiness_ready_iff_all_pass CHECK (
    ready = (
      precision_status = 'pass'
      AND fp_share_status = 'pass'
      AND fn_rate_status = 'pass'
      AND lane_health_status = 'pass'
      AND report_diff_status = 'pass'
      AND takedown_status = 'pass'
      AND stock_status = 'pass'
    )
  );

COMMENT ON TABLE public.clone_watch_readiness IS
  'v335 (#1237): the Clone Watch readiness scorecard — one row per closed month, seven components (value, n, threshold in force, pass/fail/insufficient). ready is true exactly when all seven pass (CHECK). The brand SEND paths require ready=true for the last READINESS_REQUIRED_MONTHS closed months; a missing or unreadable row is NOT ready. NULL value = not measured, never 0. Written by clone-watch-report-summary (step compute-readiness). Scoring: apps/web/lib/clone-watch/readiness.ts.';

ALTER TABLE public.clone_watch_readiness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clone_watch_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clone_watch_readiness TO service_role;

-- ── 2. SQL-side inputs for one window ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clone_watch_readiness_inputs(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
  WITH human AS (
    -- Human triage verdicts dated inside the window (see header: machine
    -- writers are excluded by their note marker).
    SELECT a.triage_status,
           (a.weaponised_at IS NOT NULL
             OR a.urlscan_classification = 'likely_phishing') AS phishing
      FROM public.shopfront_clone_alerts a
     WHERE a.triage_at >= p_start
       AND a.triage_at < p_end
       AND a.triage_status IN ('tp_confirmed', 'fp', 'needs_investigation')
       AND COALESCE(a.triage_notes, '') NOT LIKE 'auto-park:%'
       AND COALESCE(a.triage_notes, '') NOT LIKE 'auto-triage:%'
       AND COALESCE(a.triage_notes, '') NOT LIKE '[matcher-v4-audit]%'
  ),
  machine_fp AS (
    SELECT count(*)::integer AS n
      FROM public.shopfront_clone_alerts a
     WHERE a.triage_at >= p_start
       AND a.triage_at < p_end
       AND a.triage_status = 'fp'
       AND (COALESCE(a.triage_notes, '') LIKE 'auto-park:%'
         OR COALESCE(a.triage_notes, '') LIKE 'auto-triage:%'
         OR COALESCE(a.triage_notes, '') LIKE '[matcher-v4-audit]%')
  ),
  classified AS (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE c.is_clone IS FALSE)::integer AS rejected
      FROM public.clone_watch_classifications c
     WHERE c.classified_at >= p_start
       AND c.classified_at < p_end
  ),
  digest AS (
    -- One entry per health-digest firing. A row is a MEASUREMENT only when it
    -- carries the lane_problems array: rows before 2026-09-18 (and all-clear
    -- rows before v335's companion code change) have no such key.
    SELECT (l.fired_at AT TIME ZONE 'UTC')::date AS day,
           l.metadata -> 'lane_problems' AS problems
      FROM public.alert_delivery_log l
     WHERE l.alerter = 'health-digest'
       AND l.fired_at >= p_start
       AND l.fired_at < p_end
       AND pg_catalog.jsonb_typeof(l.metadata -> 'lane_problems') = 'array'
  ),
  problem AS (
    -- Only these kinds count against lane health. `braked` is excluded: a
    -- brake is an operator decision, not a lane failing.
    SELECT d.day,
           pg_catalog.split_part(e.value, ':', 1) AS kind,
           pg_catalog.substr(e.value, pg_catalog.strpos(e.value, ':') + 1) AS lane
      FROM digest d
     CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(d.problems) AS e(value)
     WHERE pg_catalog.split_part(e.value, ':', 1) IN
           ('silent_zero', 'absent', 'brake_unknown', 'cap_bound', 'quota_exhausted')
  )
  SELECT pg_catalog.jsonb_build_object(
    'human_triaged', (SELECT count(*) FROM human),
    'human_fp', (SELECT count(*) FILTER (WHERE h.triage_status = 'fp') FROM human h),
    'phishing_tp', (SELECT count(*) FILTER (WHERE h.phishing AND h.triage_status = 'tp_confirmed') FROM human h),
    'phishing_fp', (SELECT count(*) FILTER (WHERE h.phishing AND h.triage_status = 'fp') FROM human h),
    'machine_fp', (SELECT n FROM machine_fp),
    'classified', (SELECT n FROM classified),
    'classifier_rejected', (SELECT rejected FROM classified),
    'window_days', GREATEST(0, ((p_end AT TIME ZONE 'UTC')::date - (p_start AT TIME ZONE 'UTC')::date)),
    'measured_days', (SELECT count(DISTINCT d.day) FROM digest d),
    'problem_days', (SELECT count(DISTINCT p.day) FROM problem p),
    'problem_kinds', COALESCE(
      (SELECT pg_catalog.jsonb_object_agg(k.kind, k.days)
         FROM (SELECT p.kind, count(DISTINCT p.day) AS days
                 FROM problem p GROUP BY p.kind) k),
      '{}'::jsonb),
    'problem_lanes', COALESCE(
      (SELECT pg_catalog.jsonb_agg(DISTINCT p.lane ORDER BY p.lane) FROM problem p),
      '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.clone_watch_readiness_inputs(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_readiness_inputs(timestamptz, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.clone_watch_readiness_inputs(timestamptz, timestamptz) IS
  'v335 (#1237): the readiness scorecard''s SQL-side inputs for [p_start, p_end): human triage verdicts (machine note markers excluded), classifier reject share (context), and health-digest lane-health days (measured_days = days with a lane_problems array; problem_days = days with a silent_zero/absent/brake_unknown/cap_bound/quota_exhausted problem). Read by apps/web/lib/clone-watch/readiness-data.ts.';

COMMIT;
