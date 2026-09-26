-- migration-v330-clone-not-a-clone-audit-sample.sql
--
-- Map #1224, ticket #1238 (decision #1233, founder 2026-09-26): a pre-classifier
-- "not a clone" verdict is never revisited. is_clone=false alerts are parked in
-- `detected` and never urlscanned — the submit worklist
-- (list_clone_alerts_pending_urlscan_submit) requires `c.is_clone`, and the
-- recheck worklist only covers monitoring/declined — so a false negative is
-- final and invisible.
--
-- Measured in prod 2026-09-26: 607 source='nrd' alerts are `detected`,
-- is_clone=false, with no urlscan uuid and no urlscan classification (605 with
-- no evidence at all + 2 with an old failed attempt). 588 of them were judged by
-- Haiku (v1 411, v2 177), 17 by Jev (jev-1.13.0). First seen 2026-05-31 ..
-- 2026-09-25; 136 are older than the 90-day worklist horizon. ~25–35 new
-- is_clone=false alerts per week. One not-a-clone that DID get scanned
-- (threesbrewingdirect.shop, Haiku conf 0.95) is weaponised today.
--
-- What this adds (no new cron, no burst — the existing daily submit lane
-- carries every sample):
--
-- 1. clone_watch_not_a_clone_samples — one row per sampled alert (an alert is
--    sampled at most once, ever). Holds the classifier verdict snapshot at draw
--    time and `submit_attempted_at`, the stamp the submit lane writes when it has
--    tried the row (worklist-gate-starvation rule: every row the lane looks at is
--    stamped, so a row that cannot be scanned does not re-present forever).
--
-- 2. draw_clone_not_a_clone_audit_sample(cohort, …) — marks a uniformly random
--    sample of the never-scanned not-a-clone pool.
--      'baseline': the one-off ~100, run by an operator with an explicit label
--                  and size; whole pool, no horizon. Idempotent per label.
--      'weekly'  : ceil(p_fraction × pool) (min 1) of the pool inside
--                  p_horizon_days; the key is the UTC ISO week, so the daily
--                  submit lane calling it every day draws once per week.
--    Advisory-locked per key so two concurrent runs cannot both draw.
--
-- 3. list_clone_not_a_clone_audit_pending(limit) — the sample rows the submit
--    lane has not yet tried. The lane gives these a reserve of its existing 75
--    daily slots (AUDIT_SLOTS_PER_RUN in lib/clone-watch/not-a-clone-audit.ts),
--    so the lane's urlscan volume does not grow.
--
-- 4. mark_clone_not_a_clone_audit_attempted(ids) — the stamp.
--
-- 5. clone_watch_not_a_clone_audit_summary(since) — what #1237's readiness
--    scorecard reads: sampled / attempted / scanned / pending / unscannable /
--    misses / fn_rate / weaponised_later, per cohort key and classifier. A miss
--    is the FIRST urlscan verdict recorded after the draw being
--    'likely_phishing', read from clone_watch_scan_transitions (every first scan
--    of a never-classified row is a NULL → X transition, so the archive always
--    has it — v230/v307).
--
-- Re-opening a miss needs no new lifecycle code: the retrieve lane persists the
-- verdict through persist_clone_alert_urlscan (v307), which applies the v200
-- edge-guarded apply_clone_urlscan_verdict in the same transaction —
-- likely_phishing + detected → weaponised; a benign verdict + detected →
-- monitoring (which puts the row in the recheck pool, like every other scanned
-- alert). No raw lifecycle UPDATE anywhere in this migration.
--
-- Security: SECURITY DEFINER + search_path '' + fully-qualified names;
-- REVOKE FROM PUBLIC, anon, authenticated; EXECUTE to service_role only
-- (supabase/CLAUDE.md §7, v324). Function-level statement_timeout (§4 — an
-- in-body SET LOCAL is decorative through PostgREST).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY
-- IF EXISTS. Rollback: DROP the five functions and the table (it holds only
-- sample bookkeeping; the alerts and their verdicts are untouched).

BEGIN;

CREATE TABLE IF NOT EXISTS public.clone_watch_not_a_clone_samples (
  alert_id            bigint PRIMARY KEY
                        REFERENCES public.shopfront_clone_alerts(id) ON DELETE CASCADE,
  cohort              text NOT NULL CHECK (cohort IN ('baseline', 'weekly')),
  -- 'baseline:<label>' | 'weekly:<IYYY>-W<IW>' (UTC ISO week)
  cohort_key          text NOT NULL,
  sampled_at          timestamptz NOT NULL DEFAULT now(),
  -- Classifier verdict snapshot at draw time (the thing being audited).
  model_id            text,
  confidence          real,
  triage_status       text,
  -- Size of the pool this row was drawn from (same value on every row of a key).
  pool_size           integer NOT NULL,
  -- Stamped by the submit lane once it has tried the row (any outcome except a
  -- urlscan 429, which is our quota and says nothing about the URL).
  submit_attempted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_clone_nac_samples_cohort_key
  ON public.clone_watch_not_a_clone_samples (cohort_key);
CREATE INDEX IF NOT EXISTS idx_clone_nac_samples_pending
  ON public.clone_watch_not_a_clone_samples (sampled_at, alert_id)
  WHERE submit_attempted_at IS NULL;

COMMENT ON TABLE public.clone_watch_not_a_clone_samples IS
  'v330 (#1238): random audit samples of never-scanned pre-classifier is_clone=false alerts. The submit lane urlscans them from a reserve of its daily slots; clone_watch_not_a_clone_audit_summary() derives the false-negative rate from clone_watch_scan_transitions.';

ALTER TABLE public.clone_watch_not_a_clone_samples ENABLE ROW LEVEL SECURITY;

-- Service-role only: no anon/authenticated policy and no grant (v324 default
-- privileges already give them nothing; restated for defence in depth).
DROP POLICY IF EXISTS clone_nac_samples_service_role_all
  ON public.clone_watch_not_a_clone_samples;
CREATE POLICY clone_nac_samples_service_role_all
  ON public.clone_watch_not_a_clone_samples
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.clone_watch_not_a_clone_samples FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clone_watch_not_a_clone_samples TO service_role;

-- ── 2. Draw ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draw_clone_not_a_clone_audit_sample(
  p_cohort text,
  p_label text DEFAULT NULL,
  p_size integer DEFAULT NULL,
  p_fraction real DEFAULT NULL,
  p_horizon_days integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
DECLARE
  v_key text;
  v_n   integer;
BEGIN
  IF p_cohort = 'baseline' THEN
    IF p_label IS NULL OR btrim(p_label) = '' OR p_size IS NULL OR p_size < 1 THEN
      RAISE EXCEPTION 'baseline draw needs p_label and p_size >= 1'
        USING ERRCODE = '22023';
    END IF;
    v_key := 'baseline:' || btrim(p_label);
  ELSIF p_cohort = 'weekly' THEN
    IF p_fraction IS NULL OR p_fraction <= 0 OR p_fraction > 1 THEN
      RAISE EXCEPTION 'weekly draw needs 0 < p_fraction <= 1' USING ERRCODE = '22023';
    END IF;
    v_key := 'weekly:' || pg_catalog.to_char(
      pg_catalog.timezone('UTC', pg_catalog.now()), 'IYYY-"W"IW');
  ELSE
    RAISE EXCEPTION 'unknown audit cohort: %', p_cohort USING ERRCODE = '22023';
  END IF;

  -- Serialise draws of the same key; a second caller then sees the first's rows.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clone_not_a_clone_audit:' || v_key));

  IF EXISTS (SELECT 1 FROM public.clone_watch_not_a_clone_samples s
              WHERE s.cohort_key = v_key) THEN
    RETURN 0; -- already drawn for this key
  END IF;

  INSERT INTO public.clone_watch_not_a_clone_samples
    (alert_id, cohort, cohort_key, model_id, confidence, triage_status, pool_size)
  SELECT x.id, p_cohort, v_key, x.model_id, x.confidence, x.triage_status, x.pool_n
  FROM (
    SELECT
      sca.id, c.model_id, c.confidence, sca.triage_status,
      count(*) OVER ()::integer AS pool_n,
      row_number() OVER (ORDER BY pg_catalog.random()) AS rn
    FROM public.shopfront_clone_alerts sca
    JOIN public.clone_watch_classifications c ON c.alert_id = sca.id
    WHERE sca.source = 'nrd'
      AND sca.lifecycle_state = 'detected'
      AND c.is_clone IS FALSE
      AND sca.urlscan_uuid IS NULL
      AND sca.urlscan_classification IS NULL
      AND (p_horizon_days IS NULL
           OR sca.first_seen_at >= pg_catalog.now()
                                    - pg_catalog.make_interval(days => GREATEST(1, p_horizon_days)))
      AND NOT EXISTS (SELECT 1 FROM public.clone_watch_not_a_clone_samples s
                       WHERE s.alert_id = sca.id)
  ) x
  WHERE x.rn <= LEAST(
    200,
    COALESCE(p_size, GREATEST(1, pg_catalog.ceil(x.pool_n * p_fraction)::integer))
  );

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.draw_clone_not_a_clone_audit_sample(text, text, integer, real, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.draw_clone_not_a_clone_audit_sample(text, text, integer, real, integer)
  TO service_role;

-- ── 3. The submit lane's audit worklist ─────────────────────────────────────
-- A sample leaves this list the moment the lane stamps it, OR the alert gains a
-- uuid / a classification (it got scanned by any path), OR urlscan evidence
-- shows an attempt after the draw (belt and braces if the stamp write failed —
-- a DNS-dead row otherwise has no uuid and would re-present daily). COALESCE on
-- every nullable comparison: a NULL here must mean "not attempted", never
-- "filtered out".
CREATE OR REPLACE FUNCTION public.list_clone_not_a_clone_audit_pending(p_limit integer DEFAULT 25)
RETURNS TABLE(id bigint, candidate_url text, candidate_domain text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
  SELECT sca.id, sca.candidate_url, sca.candidate_domain
  FROM public.clone_watch_not_a_clone_samples s
  JOIN public.shopfront_clone_alerts sca ON sca.id = s.alert_id
  WHERE s.submit_attempted_at IS NULL
    AND sca.urlscan_uuid IS NULL
    AND sca.urlscan_classification IS NULL
    AND COALESCE((sca.urlscan_evidence ->> 'attempted_at')::timestamptz, '-infinity'::timestamptz)
        < s.sampled_at
  ORDER BY s.sampled_at ASC, s.alert_id ASC
  LIMIT GREATEST(0, LEAST(p_limit, 100));
$$;

REVOKE ALL ON FUNCTION public.list_clone_not_a_clone_audit_pending(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_not_a_clone_audit_pending(integer)
  TO service_role;

-- ── 4. The stamp ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_clone_not_a_clone_audit_attempted(p_alert_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.clone_watch_not_a_clone_samples s
     SET submit_attempted_at = pg_catalog.now()
   WHERE s.alert_id = ANY (p_alert_ids)
     AND s.submit_attempted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_clone_not_a_clone_audit_attempted(bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_clone_not_a_clone_audit_attempted(bigint[])
  TO service_role;

-- ── 5. The measurement (#1237 reads this) ────────────────────────────────────
-- Per sample:
--   scanned      a urlscan verdict was recorded at/after the draw
--   miss         that FIRST post-draw verdict is likely_phishing
--   unscannable  tried, no verdict, and nothing left to wait for (no uuid, or a
--                uuid whose retrieve failed 3 times — the retrieve lane's
--                p_max_failure_streak default)
--   pending      everything else without a verdict (not yet tried, or waiting
--                for retrieval)
--   weaponised_later  first verdict was benign but the alert is now weaponised
--                / reported / taken_down (caught later by the recheck lane)
-- fn_rate = misses / scanned (NULL when nothing is scanned yet).
CREATE OR REPLACE FUNCTION public.clone_watch_not_a_clone_audit_summary(p_since timestamptz DEFAULT NULL)
RETURNS TABLE(
  cohort text,
  cohort_key text,
  classifier text,
  sampled integer,
  attempted integer,
  scanned integer,
  pending integer,
  unscannable integer,
  misses integer,
  fn_rate numeric,
  weaponised_later integer,
  pool_size integer,
  first_sampled_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
  WITH per_sample AS (
    SELECT
      s.cohort, s.cohort_key, s.sampled_at, s.pool_size, s.submit_attempted_at,
      CASE
        WHEN s.model_id LIKE 'jev-%' THEN 'jev'
        WHEN s.model_id LIKE 'claude-haiku%' THEN 'haiku'
        ELSE COALESCE(s.model_id, 'unknown')
      END AS classifier,
      sca.urlscan_uuid, sca.urlscan_failure_streak, sca.lifecycle_state,
      (SELECT t.new_classification
         FROM public.clone_watch_scan_transitions t
        WHERE t.alert_id = s.alert_id
          AND t.scanned_at >= s.sampled_at
        ORDER BY t.scanned_at ASC, t.id ASC
        LIMIT 1) AS first_verdict
    FROM public.clone_watch_not_a_clone_samples s
    JOIN public.shopfront_clone_alerts sca ON sca.id = s.alert_id
    WHERE p_since IS NULL OR s.sampled_at >= p_since
  ),
  flagged AS (
    SELECT p.*,
      (p.first_verdict IS NULL
        AND p.submit_attempted_at IS NOT NULL
        AND (p.urlscan_uuid IS NULL OR COALESCE(p.urlscan_failure_streak, 0) >= 3)
      ) AS is_unscannable
    FROM per_sample p
  )
  SELECT
    f.cohort,
    f.cohort_key,
    f.classifier,
    count(*)::integer,
    count(*) FILTER (WHERE f.submit_attempted_at IS NOT NULL)::integer,
    count(*) FILTER (WHERE f.first_verdict IS NOT NULL)::integer,
    count(*) FILTER (WHERE f.first_verdict IS NULL AND NOT f.is_unscannable)::integer,
    count(*) FILTER (WHERE f.is_unscannable)::integer,
    count(*) FILTER (WHERE f.first_verdict = 'likely_phishing')::integer,
    round(
      (count(*) FILTER (WHERE f.first_verdict = 'likely_phishing'))::numeric
      / NULLIF(count(*) FILTER (WHERE f.first_verdict IS NOT NULL), 0),
      4),
    count(*) FILTER (
      WHERE f.first_verdict IS NOT NULL
        AND f.first_verdict <> 'likely_phishing'
        AND f.lifecycle_state IN ('weaponised', 'reported', 'taken_down')
    )::integer,
    max(f.pool_size)::integer,
    min(f.sampled_at)
  FROM flagged f
  GROUP BY f.cohort, f.cohort_key, f.classifier
  ORDER BY min(f.sampled_at) ASC, f.classifier ASC;
$$;

REVOKE ALL ON FUNCTION public.clone_watch_not_a_clone_audit_summary(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_not_a_clone_audit_summary(timestamptz)
  TO service_role;

COMMIT;
