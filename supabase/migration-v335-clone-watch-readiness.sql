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
--   2. shopfront_clone_alerts.triage_source ('human' | 'machine', nullable) —
--      who set the CURRENT triage_status, recorded apart from triage_notes.
--      The note is not a discriminator: set_clone_alert_triage writes
--      `triage_notes = COALESCE(p_notes, triage_notes)` and the triage UI
--      sends no notes, so a human verdict on an alert auto-park (392 rows) or
--      the matcher-v4 audit (466 rows) had already noted KEPT the machine note
--      and read as machine (review of #1260, H1). NULL = written before v335.
--      Writers: set_clone_alert_triage stamps p_source (default 'human'; the
--      admin triage route is its only caller); auto-park.ts stamps 'machine'.
--      Not stamped, deliberately: merge_clone_alert_submission (Netcraft's
--      tp_confirmed → tp_actioned keeps the human origin and triage_at, which
--      is what makes tp_actioned a human TP) and persist_clone_alert_urlscan
--      (only ever suggests needs_investigation, which is not a verdict).
--   3. set_clone_alert_triage — re-created from its LIVE prod body
--      (pg_get_functiondef, 2026-09-27) + p_source. The 4-arg signature is
--      DROPPED in the same transaction: a 5-arg overload beside it would make
--      the route's named-argument call ambiguous in PostgREST. Callers passing
--      the four named args are unaffected (p_source defaults to 'human').
--      Grants restated: the live ACL was postgres + service_role only. Adds a
--      function-level statement_timeout (the live one had none).
--   4. clone_watch_readiness_inputs(p_start, p_end) — the SQL-side inputs
--      (triage verdicts, classifier context, lane-health days) for one window,
--      as one jsonb. NULL-honest: a day with no health-digest row, or a row
--      predating the lane_problems key, is NOT measured — never a clean day.
--
-- Human verdicts = DECIDED statuses only (tp_confirmed, tp_actioned, fp;
-- needs_investigation is a deferral, not a verdict — H2), triage_at inside the
-- window (Netcraft never stamps triage_at, so a tp_actioned row with triage_at
-- in the window was confirmed by a human then — M1), and:
--   triage_source = 'human', OR (pre-v335 history) triage_source IS NULL and
--   no machine note marker: `auto-park%` (covers the 98-row
--   `auto-park (one-time backfill…)` form), `auto-triage%`,
--   `[matcher-v4-audit]%`.
-- A new machine writer MUST stamp triage_source = 'machine'.
--
-- Security (supabase/CLAUDE.md §7, v324): RLS on, no policies (deny-all for
-- anon/authenticated), explicit REVOKE from anon/authenticated, service_role
-- only. Both functions are SECURITY DEFINER with REVOKE FROM PUBLIC, anon,
-- authenticated and EXECUTE to service_role; the inputs function uses
-- search_path '' + fully-qualified names; set_clone_alert_triage keeps its
-- live `public, pg_catalog`. Function-level statement_timeout on both (§4).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE OR
-- REPLACE, DROP … IF EXISTS before ADD/CREATE. triage_source is a nullable
-- column with no default (metadata-only ALTER; shopfront_clone_alerts is not a
-- hot table, ~3.7k rows, and its CHECK validates in milliseconds). No backfill:
-- history is judged by the note-marker rule above.
-- Rollback: DROP FUNCTION clone_watch_readiness_inputs(timestamptz,
-- timestamptz); DROP TABLE clone_watch_readiness (with it gone the send gate
-- reads "unreadable" and fails CLOSED); re-create set_clone_alert_triage from
-- its pre-v335 body (the 4-arg form quoted in section 3's comment) after
-- DROP FUNCTION set_clone_alert_triage(bigint, text, uuid, text, text); the
-- triage_source column may stay (additive, nothing else reads it).

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

-- ── 2. Verdict origin ───────────────────────────────────────────────────────
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS triage_source text;
ALTER TABLE public.shopfront_clone_alerts
  DROP CONSTRAINT IF EXISTS shopfront_clone_alerts_triage_source_check;
ALTER TABLE public.shopfront_clone_alerts
  ADD CONSTRAINT shopfront_clone_alerts_triage_source_check
  CHECK (triage_source IS NULL OR triage_source IN ('human', 'machine'));
COMMENT ON COLUMN public.shopfront_clone_alerts.triage_source IS
  'v335 (#1237): who set the current triage_status — human (set_clone_alert_triage, the admin triage route) or machine (auto-park). NULL = written before v335; judged by note marker. Not stamped by merge_clone_alert_submission (Netcraft tp_confirmed→tp_actioned keeps the human origin) or persist_clone_alert_urlscan (suggests needs_investigation only).';

-- ── 3. set_clone_alert_triage + p_source ────────────────────────────────────
-- DROP justified above (header §3): replaced by a superset signature in the
-- same transaction, so there is no moment without a triage writer. The
-- pre-v335 body is the one below minus the triage_source line and p_source.
DROP FUNCTION IF EXISTS public.set_clone_alert_triage(bigint, text, uuid, text);

CREATE OR REPLACE FUNCTION public.set_clone_alert_triage(
  p_alert_id bigint,
  p_status text,
  p_admin_id uuid,
  p_notes text DEFAULT NULL::text,
  p_source text DEFAULT 'human'::text
)
RETURNS TABLE(id bigint, triage_status text, triage_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
SET statement_timeout = '15s'
AS $function$
BEGIN
  IF p_status NOT IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned') THEN
    RAISE EXCEPTION 'invalid triage status: %', p_status USING ERRCODE = '22023';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('human', 'machine') THEN
    RAISE EXCEPTION 'invalid triage source: %', p_source USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.shopfront_clone_alerts
  SET triage_status = p_status,
      triage_by = p_admin_id,
      triage_at = now(),
      triage_notes = COALESCE(p_notes, triage_notes),
      triage_source = p_source
  WHERE shopfront_clone_alerts.id = p_alert_id
  RETURNING shopfront_clone_alerts.id, shopfront_clone_alerts.triage_status, shopfront_clone_alerts.triage_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_clone_alert_triage(bigint, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_clone_alert_triage(bigint, text, uuid, text, text)
  TO service_role;

-- ── 4. SQL-side inputs for one window ───────────────────────────────────────
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
  WITH triaged AS (
    SELECT a.triage_status,
           (a.weaponised_at IS NOT NULL
             OR a.urlscan_classification = 'likely_phishing') AS phishing,
           CASE
             WHEN a.triage_source IS NOT NULL THEN a.triage_source = 'human'
             ELSE COALESCE(a.triage_notes, '') NOT LIKE 'auto-park%'
              AND COALESCE(a.triage_notes, '') NOT LIKE 'auto-triage%'
              AND COALESCE(a.triage_notes, '') NOT LIKE '[matcher-v4-audit]%'
           END AS human
      FROM public.shopfront_clone_alerts a
     WHERE a.triage_at >= p_start
       AND a.triage_at < p_end
       AND a.triage_status IN ('tp_confirmed', 'tp_actioned', 'fp', 'needs_investigation')
  ),
  decided AS (
    -- Human, DECIDED verdicts only (needs_investigation is a deferral).
    SELECT t.triage_status, t.phishing,
           (t.triage_status IN ('tp_confirmed', 'tp_actioned')) AS tp
      FROM triaged t
     WHERE t.human
       AND t.triage_status IN ('tp_confirmed', 'tp_actioned', 'fp')
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
    'human_decided', (SELECT count(*) FROM decided),
    'human_fp', (SELECT count(*) FILTER (WHERE NOT d.tp) FROM decided d),
    'phishing_tp', (SELECT count(*) FILTER (WHERE d.phishing AND d.tp) FROM decided d),
    'phishing_fp', (SELECT count(*) FILTER (WHERE d.phishing AND NOT d.tp) FROM decided d),
    'human_deferred', (SELECT count(*) FILTER (WHERE t.human AND t.triage_status = 'needs_investigation') FROM triaged t),
    'machine_fp', (SELECT count(*) FILTER (WHERE NOT t.human AND t.triage_status = 'fp') FROM triaged t),
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
  'v335 (#1237): the readiness scorecard''s SQL-side inputs for [p_start, p_end): human DECIDED verdicts (tp_confirmed/tp_actioned/fp; origin = triage_source, or for pre-v335 rows no machine note marker), classifier reject share (context), and health-digest lane-health days (measured_days = days with a lane_problems array; problem_days = days with a silent_zero/absent/brake_unknown/cap_bound/quota_exhausted problem). Read by apps/web/lib/clone-watch/readiness-data.ts.';

COMMIT;
