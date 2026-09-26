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
-- is_clone=false, with no urlscan uuid and no urlscan classification. 588 of
-- them were judged by Haiku, 17 by Jev. 129 carry triage_status='fp' (one bulk
-- pass, 2026-09-04) and are EXCLUDED from every draw: 478 remain, 371 of them
-- inside the 90-day horizon.
--
-- THE AUDIT IS MEASUREMENT (lead decision on PR #1249). A miss is surfaced for
-- human review; it is never acted on externally under the brand label the
-- classifier rejected. So:
--
-- 1. clone_watch_not_a_clone_samples — one row per sampled alert (sampled at
--    most once, ever), with the classifier snapshot and the alert's age at draw
--    time, the attempt ledger (attempts, last_attempt_at) and the miss record
--    (miss_at, miss_warned_at).
--
-- 2. apply_clone_urlscan_verdict is re-created with ONE new branch: a
--    likely_phishing verdict on a SAMPLED alert whose classification is still
--    is_clone=false goes to `monitoring` (from detected; monitoring/declined
--    stay put), NEVER to `weaponised`, and never sets weaponised_at. Every
--    weaponised consumer — the retrieve emit (worklist keyed on weaponised_at),
--    feed-platform (scam_urls/scam_entities under the rejected brand),
--    notify-weaponised, enforcement-plan, the Netcraft lanes — is therefore
--    unreachable from an audit miss, whichever path persisted the verdict
--    (retrieve, the submit lane's reputation fallback, or a later recheck).
--    The miss is stamped on the sample row in the same transaction; the submit
--    lane claims new misses daily and logs one always-ship warn each for
--    operator review. The rest of the body is byte-for-byte the live prod
--    definition (pg_get_functiondef, 2026-09-26); ACL restated. The live
--    function has no function-level statement_timeout (proconfig is only
--    search_path) and none is added: it only ever runs nested inside
--    persist_clone_alert_urlscan, where a function-level timeout would not
--    re-arm the caller's timer anyway (supabase/CLAUDE.md §4).
--
-- 3. Attempts, not a one-shot stamp. A sample with no verdict is re-offered on
--    a 168 h cadence up to 3 attempts (a DNS-dead, SERVFAIL, refused or thrown
--    attempt; or a submitted scan whose retrieve failed out). It is
--    "unscannable" only when the attempts are exhausted with no verdict. The
--    state of every sample is computed in ONE place,
--    clone_watch_not_a_clone_audit_sample_states(), which both the worklist and
--    the summary read — there is no second copy of "attempted" to drift.
--
-- 4. Recheck: a sampled is_clone=false alert in the recheck pool (a benign
--    scan moved it detected → monitoring) is rechecked weekly, not every 6 h,
--    and its first-recheck clock starts at its audit scan instead of NULL-first.
--    The recheck lane is at cap every run; these rows are low-yield.
--    list_clone_alerts_for_recheck is re-created from the v328 body (due_total
--    kept) with that one cadence branch and ordering key added.
--
-- 5. clone_watch_not_a_clone_audit_summary(since) — what #1237's scorecard
--    reads, per cohort key × classifier × age band: sampled, attempted, scanned,
--    pending, unscannable, misses, fn_rate (misses / scanned), per-verdict
--    counts, phishing_later and weaponised_later.
--
-- Security: SECURITY DEFINER + search_path '' + fully-qualified names on every
-- new function; REVOKE FROM PUBLIC, anon, authenticated; EXECUTE to
-- service_role only (supabase/CLAUDE.md §7, v324). Function-level
-- statement_timeout on every new function (§4).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY
-- IF EXISTS. Rollback: re-apply v200's apply_clone_urlscan_verdict body (the
-- live one minus the audit branch) and v328's list_clone_alerts_for_recheck,
-- then DROP the new functions and the table. The alerts and their verdicts are
-- untouched.

BEGIN;

-- ── 1. The sample ledger ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clone_watch_not_a_clone_samples (
  alert_id         bigint PRIMARY KEY
                     REFERENCES public.shopfront_clone_alerts(id) ON DELETE CASCADE,
  cohort           text NOT NULL CHECK (cohort IN ('baseline', 'weekly')),
  -- 'baseline:<label>' | 'weekly:<IYYY>-W<IW>' (UTC ISO week)
  cohort_key       text NOT NULL,
  sampled_at       timestamptz NOT NULL DEFAULT now(),
  -- Classifier verdict snapshot at draw time (the thing being audited).
  model_id         text,
  confidence       real,
  classified_at    timestamptz,
  triage_status    text,
  -- The alert's first sighting, so the summary can split by age at draw.
  first_seen_at    timestamptz,
  -- Size of the pool this row was drawn from (same on every row of a key).
  pool_size        integer NOT NULL,
  -- Attempt ledger, written only by the submit lane's stamp. A urlscan 429 is
  -- our quota, not an attempt, and is never counted.
  attempts         integer NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  -- Set by apply_clone_urlscan_verdict when a likely_phishing verdict lands on
  -- this sample while its classification is is_clone=false (any verdict,
  -- first or later). miss_warned_at: the submit lane logged it for review.
  miss_at          timestamptz,
  miss_warned_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_clone_nac_samples_cohort_key
  ON public.clone_watch_not_a_clone_samples (cohort_key);
CREATE INDEX IF NOT EXISTS idx_clone_nac_samples_unwarned_miss
  ON public.clone_watch_not_a_clone_samples (miss_at)
  WHERE miss_at IS NOT NULL AND miss_warned_at IS NULL;

COMMENT ON TABLE public.clone_watch_not_a_clone_samples IS
  'v330 (#1238): random audit samples of never-scanned pre-classifier is_clone=false alerts. MEASUREMENT ONLY: a likely_phishing verdict on a sample is routed to monitoring (apply_clone_urlscan_verdict), recorded as miss_at and logged for human review — never weaponised. State per row: clone_watch_not_a_clone_audit_sample_states(); rate: clone_watch_not_a_clone_audit_summary().';

ALTER TABLE public.clone_watch_not_a_clone_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clone_nac_samples_service_role_all
  ON public.clone_watch_not_a_clone_samples;
CREATE POLICY clone_nac_samples_service_role_all
  ON public.clone_watch_not_a_clone_samples
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.clone_watch_not_a_clone_samples FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clone_watch_not_a_clone_samples TO service_role;

-- ── 2. The transition, where it is decided ──────────────────────────────────
-- Live prod body (pg_get_functiondef 2026-09-26) + the audit branch marked v330.
CREATE OR REPLACE FUNCTION public.apply_clone_urlscan_verdict(p_alert_id bigint, p_classification text, p_evidence jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_current text;
  v_next    text;
  v_audit_miss boolean := false;
BEGIN
  -- FOR UPDATE serialises the read-modify-write against a concurrent
  -- advance_clone_lifecycle on the same alert (else a stale read could
  -- blindly overwrite a fresher state written between SELECT and UPDATE).
  SELECT lifecycle_state INTO v_current
  FROM public.shopfront_clone_alerts
  WHERE id = p_alert_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_evidence IS NOT NULL AND jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'apply_clone_urlscan_verdict: p_evidence must be a jsonb object, got %',
      jsonb_typeof(p_evidence) USING ERRCODE = '22023';
  END IF;

  IF p_classification = 'likely_phishing'
     AND v_current IN ('detected', 'monitoring', 'declined') THEN
    -- v330 (#1238): a not-a-clone AUDIT SAMPLE is measurement. Its miss goes
    -- to monitoring for human review — never weaponised, so no weaponised
    -- consumer (feed-platform, notify-weaponised, enforcement, Netcraft) can
    -- act on it under the brand the classifier rejected.
    IF EXISTS (
      SELECT 1
      FROM public.clone_watch_not_a_clone_samples s
      JOIN public.clone_watch_classifications c ON c.alert_id = s.alert_id
      WHERE s.alert_id = p_alert_id
        AND c.is_clone IS FALSE
    ) THEN
      v_audit_miss := true;
      v_next := CASE WHEN v_current = 'detected' THEN 'monitoring' ELSE v_current END;
      UPDATE public.clone_watch_not_a_clone_samples
         SET miss_at = COALESCE(miss_at, now())
       WHERE alert_id = p_alert_id;
    ELSE
      v_next := 'weaponised';
    END IF;
  ELSIF p_classification IN ('parked_for_sale', 'neutral', 'unresolved')
     AND v_current = 'detected' THEN
    v_next := 'monitoring';
  ELSE
    v_next := v_current;
  END IF;

  IF v_next <> v_current OR p_evidence IS NOT NULL THEN
    UPDATE public.shopfront_clone_alerts
    SET lifecycle_state = v_next,
        weaponised_at = CASE WHEN v_next = 'weaponised'
                             THEN COALESCE(weaponised_at, now()) ELSE weaponised_at END,
        evidence = CASE WHEN p_evidence IS NULL THEN evidence ELSE evidence || p_evidence END,
        updated_at = now()
    WHERE id = p_alert_id;
  END IF;

  RETURN jsonb_build_object(
    'state', v_next,
    'prior', v_current,
    'newly_weaponised', (v_next = 'weaponised' AND v_current <> 'weaponised'),
    'audit_miss', v_audit_miss
  );
END
$function$;

REVOKE ALL ON FUNCTION public.apply_clone_urlscan_verdict(bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_clone_urlscan_verdict(bigint, text, jsonb)
  TO service_role;

-- ── 3. Draw ──────────────────────────────────────────────────────────────────
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
    (alert_id, cohort, cohort_key, model_id, confidence, classified_at,
     triage_status, first_seen_at, pool_size)
  SELECT x.id, p_cohort, v_key, x.model_id, x.confidence, x.classified_at,
         x.triage_status, x.first_seen_at, x.pool_n
  FROM (
    SELECT
      sca.id, c.model_id, c.confidence, c.classified_at, sca.triage_status,
      sca.first_seen_at,
      count(*) OVER ()::integer AS pool_n,
      row_number() OVER (ORDER BY pg_catalog.random()) AS rn
    FROM public.shopfront_clone_alerts sca
    JOIN public.clone_watch_classifications c ON c.alert_id = sca.id
    WHERE sca.source = 'nrd'
      AND sca.lifecycle_state = 'detected'
      AND c.is_clone IS FALSE
      AND sca.urlscan_uuid IS NULL
      AND sca.urlscan_classification IS NULL
      -- A row an operator (or the 2026-09-04 bulk pass) marked fp is not
      -- sampled: it is not a pure classifier verdict, and nothing downstream
      -- should ever be asked to reconsider it.
      AND COALESCE(sca.triage_status, '') <> 'fp'
      AND (p_horizon_days IS NULL
           OR sca.first_seen_at >= pg_catalog.now()
                                    - pg_catalog.make_interval(days => GREATEST(1, p_horizon_days)))
      AND NOT EXISTS (SELECT 1 FROM public.clone_watch_not_a_clone_samples s
                       WHERE s.alert_id = sca.id)
  ) x
  WHERE x.rn <= LEAST(
    200,
    COALESCE(p_size, GREATEST(1, pg_catalog.ceil(x.pool_n * p_fraction)::integer))
  )
  -- A concurrent draw under a DIFFERENT key (baseline vs weekly) can pick the
  -- same alert; the advisory lock is per key, so the PK decides and the loser
  -- skips it instead of raising.
  ON CONFLICT (alert_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.draw_clone_not_a_clone_audit_sample(text, text, integer, real, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.draw_clone_not_a_clone_audit_sample(text, text, integer, real, integer)
  TO service_role;

-- ── 4. ONE definition of a sample's state ───────────────────────────────────
-- Both the submit lane's worklist and the summary read this; neither restates
-- the predicates.
--   scanned      a urlscan verdict was recorded at/after the draw
--   in_flight    submitted (has a uuid) and the retrieve has not failed out
--   unscannable  no verdict and p_max_attempts attempts used
--   due          no verdict, attempts left, cadence elapsed (or never tried)
--   waiting      no verdict, attempts left, inside the cadence
-- The attempt clock is the later of the lane's stamp and a urlscan attempt
-- recorded in evidence after the draw — so a lost stamp still waits out the
-- cadence instead of re-presenting daily. GREATEST ignores NULLs.
CREATE OR REPLACE FUNCTION public.clone_watch_not_a_clone_audit_sample_states(
  p_max_attempts integer DEFAULT 3,
  p_cadence_hours integer DEFAULT 168
)
RETURNS TABLE(
  alert_id bigint,
  cohort text,
  cohort_key text,
  classifier text,
  age_band text,
  sampled_at timestamptz,
  pool_size integer,
  attempts integer,
  last_attempt_at timestamptz,
  first_verdict text,
  later_phishing boolean,
  miss_at timestamptz,
  weaponised_at timestamptz,
  candidate_url text,
  candidate_domain text,
  attempted boolean,
  state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
  WITH base AS (
    SELECT
      s.alert_id, s.cohort, s.cohort_key, s.sampled_at, s.pool_size,
      s.attempts, s.miss_at,
      CASE
        WHEN s.model_id LIKE 'jev-%' THEN 'jev'
        WHEN s.model_id LIKE 'claude-haiku%' THEN 'haiku'
        ELSE COALESCE(s.model_id, 'unknown')
      END AS classifier,
      CASE
        WHEN s.first_seen_at IS NULL THEN 'unknown'
        WHEN s.sampled_at - s.first_seen_at <= interval '30 days' THEN '0-30d'
        WHEN s.sampled_at - s.first_seen_at <= interval '90 days' THEN '31-90d'
        ELSE '90d+'
      END AS age_band,
      GREATEST(
        s.last_attempt_at,
        CASE
          WHEN (sca.urlscan_evidence ->> 'attempted_at') IS NOT NULL
           AND (sca.urlscan_evidence ->> 'attempted_at')::timestamptz >= s.sampled_at
          THEN (sca.urlscan_evidence ->> 'attempted_at')::timestamptz
        END
      ) AS last_attempt_at,
      sca.urlscan_uuid, sca.urlscan_failure_streak, sca.weaponised_at,
      sca.candidate_url, sca.candidate_domain,
      (SELECT t.new_classification
         FROM public.clone_watch_scan_transitions t
        WHERE t.alert_id = s.alert_id
          AND t.scanned_at >= s.sampled_at
        ORDER BY t.scanned_at ASC, t.id ASC
        LIMIT 1) AS first_verdict,
      (SELECT t.scanned_at
         FROM public.clone_watch_scan_transitions t
        WHERE t.alert_id = s.alert_id
          AND t.scanned_at >= s.sampled_at
        ORDER BY t.scanned_at ASC, t.id ASC
        LIMIT 1) AS first_verdict_at
    FROM public.clone_watch_not_a_clone_samples s
    JOIN public.shopfront_clone_alerts sca ON sca.id = s.alert_id
  )
  SELECT
    b.alert_id, b.cohort, b.cohort_key, b.classifier, b.age_band, b.sampled_at,
    b.pool_size, b.attempts, b.last_attempt_at, b.first_verdict,
    (b.first_verdict IS NOT NULL
      AND b.first_verdict <> 'likely_phishing'
      AND EXISTS (
        SELECT 1 FROM public.clone_watch_scan_transitions t2
        WHERE t2.alert_id = b.alert_id
          AND t2.scanned_at > b.first_verdict_at
          AND t2.new_classification = 'likely_phishing'
      )) AS later_phishing,
    b.miss_at, b.weaponised_at, b.candidate_url, b.candidate_domain,
    -- "attempted": the lane tried it (stamp or evidence clock), or a scan
    -- exists / is in flight by any path.
    (COALESCE(b.attempts, 0) > 0
      OR b.last_attempt_at IS NOT NULL
      OR b.first_verdict IS NOT NULL
      OR b.urlscan_uuid IS NOT NULL) AS attempted,
    CASE
      WHEN b.first_verdict IS NOT NULL THEN 'scanned'
      WHEN b.urlscan_uuid IS NOT NULL
       AND COALESCE(b.urlscan_failure_streak, 0) < 3 THEN 'in_flight'
      WHEN COALESCE(b.attempts, 0) >= p_max_attempts THEN 'unscannable'
      WHEN b.last_attempt_at IS NULL
        OR b.last_attempt_at < pg_catalog.now()
             - pg_catalog.make_interval(hours => GREATEST(1, p_cadence_hours))
        THEN 'due'
      ELSE 'waiting'
    END AS state
  FROM base b;
$$;

REVOKE ALL ON FUNCTION public.clone_watch_not_a_clone_audit_sample_states(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_not_a_clone_audit_sample_states(integer, integer)
  TO service_role;

-- ── 5. The submit lane's audit worklist ─────────────────────────────────────
-- `due` rows only. Never-tried rows first, then the longest-waiting retry, so
-- a dead row that just failed cannot hold the head of the list.
CREATE OR REPLACE FUNCTION public.list_clone_not_a_clone_audit_pending(p_limit integer DEFAULT 25)
RETURNS TABLE(id bigint, candidate_url text, candidate_domain text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
  SELECT st.alert_id, st.candidate_url, st.candidate_domain
  FROM public.clone_watch_not_a_clone_audit_sample_states() st
  WHERE st.state = 'due'
  ORDER BY st.last_attempt_at ASC NULLS FIRST, st.sampled_at ASC, st.alert_id ASC
  LIMIT GREATEST(0, LEAST(p_limit, 100));
$$;

REVOKE ALL ON FUNCTION public.list_clone_not_a_clone_audit_pending(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_not_a_clone_audit_pending(integer)
  TO service_role;

-- ── 6. The attempt stamp ─────────────────────────────────────────────────────
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
     SET attempts = s.attempts + 1,
         last_attempt_at = pg_catalog.now()
   WHERE s.alert_id = ANY (p_alert_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_clone_not_a_clone_audit_attempted(bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_clone_not_a_clone_audit_attempted(bigint[])
  TO service_role;

-- ── 7. Claim new misses for the operator warn ───────────────────────────────
-- Returns each miss once (stamps miss_warned_at in the same statement). The
-- submit lane logs one always-ship warn per returned row.
CREATE OR REPLACE FUNCTION public.claim_clone_not_a_clone_audit_misses(p_limit integer DEFAULT 50)
RETURNS TABLE(alert_id bigint, candidate_domain text, candidate_url text,
              cohort_key text, model_id text, confidence real, miss_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
  WITH claimed AS (
    UPDATE public.clone_watch_not_a_clone_samples s
       SET miss_warned_at = pg_catalog.now()
     WHERE s.alert_id IN (
       SELECT s2.alert_id FROM public.clone_watch_not_a_clone_samples s2
        WHERE s2.miss_at IS NOT NULL AND s2.miss_warned_at IS NULL
        ORDER BY s2.miss_at ASC
        LIMIT GREATEST(1, LEAST(p_limit, 200))
     )
    RETURNING s.alert_id, s.cohort_key, s.model_id, s.confidence, s.miss_at
  )
  SELECT c.alert_id, sca.candidate_domain, sca.candidate_url, c.cohort_key,
         c.model_id, c.confidence, c.miss_at
  FROM claimed c
  JOIN public.shopfront_clone_alerts sca ON sca.id = c.alert_id
  ORDER BY c.miss_at ASC;
$$;

REVOKE ALL ON FUNCTION public.claim_clone_not_a_clone_audit_misses(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_clone_not_a_clone_audit_misses(integer)
  TO service_role;

-- ── 8. The measurement (#1237 reads this) ────────────────────────────────────
-- fn_rate = misses / scanned (NULL when nothing is scanned yet). A miss is the
-- FIRST post-draw verdict being likely_phishing. phishing_later: first verdict
-- benign, a later one likely_phishing (recheck caught it). weaponised_later:
-- weaponised_at is set — only possible if the alert was later re-judged
-- is_clone=true, since a sampled is_clone=false alert cannot be weaponised.
CREATE OR REPLACE FUNCTION public.clone_watch_not_a_clone_audit_summary(p_since timestamptz DEFAULT NULL)
RETURNS TABLE(
  cohort text,
  cohort_key text,
  classifier text,
  age_band text,
  sampled integer,
  attempted integer,
  scanned integer,
  pending integer,
  unscannable integer,
  misses integer,
  fn_rate numeric,
  verdict_likely_phishing integer,
  verdict_neutral integer,
  verdict_parked_for_sale integer,
  verdict_unresolved integer,
  phishing_later integer,
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
  SELECT
    st.cohort,
    st.cohort_key,
    st.classifier,
    st.age_band,
    count(*)::integer,
    count(*) FILTER (WHERE st.attempted)::integer,
    count(*) FILTER (WHERE st.state = 'scanned')::integer,
    count(*) FILTER (WHERE st.state IN ('due', 'waiting', 'in_flight'))::integer,
    count(*) FILTER (WHERE st.state = 'unscannable')::integer,
    count(*) FILTER (WHERE st.first_verdict = 'likely_phishing')::integer,
    round(
      (count(*) FILTER (WHERE st.first_verdict = 'likely_phishing'))::numeric
      / NULLIF(count(*) FILTER (WHERE st.state = 'scanned'), 0),
      4),
    count(*) FILTER (WHERE st.first_verdict = 'likely_phishing')::integer,
    count(*) FILTER (WHERE st.first_verdict = 'neutral')::integer,
    count(*) FILTER (WHERE st.first_verdict = 'parked_for_sale')::integer,
    count(*) FILTER (WHERE st.first_verdict = 'unresolved')::integer,
    count(*) FILTER (WHERE st.later_phishing)::integer,
    count(*) FILTER (WHERE st.weaponised_at IS NOT NULL)::integer,
    max(st.pool_size)::integer,
    min(st.sampled_at)
  FROM public.clone_watch_not_a_clone_audit_sample_states() st
  WHERE p_since IS NULL OR st.sampled_at >= p_since
  GROUP BY st.cohort, st.cohort_key, st.classifier, st.age_band
  ORDER BY min(st.sampled_at) ASC, st.classifier ASC, st.age_band ASC;
$$;

REVOKE ALL ON FUNCTION public.clone_watch_not_a_clone_audit_summary(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_not_a_clone_audit_summary(timestamptz)
  TO service_role;

-- ── 9. Recheck: sampled not-a-clones at the weekly cadence ──────────────────
-- v328 body (pg_get_function_result 2026-09-26 confirms due_total is live) with
-- one cadence branch and the ordering key. Signature and OUT columns unchanged,
-- so CREATE OR REPLACE. `nac_audit` = sampled AND still is_clone=false.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_recheck(p_limit integer DEFAULT 50, p_cadence_hours integer DEFAULT 6, p_dead_cadence_hours integer DEFAULT 168)
 RETURNS TABLE(id bigint, candidate_domain text, candidate_url text, lifecycle_state text, urlscan_classification text, recheck_count integer, last_rechecked_at timestamp with time zone, signals jsonb, attribution jsonb, clf_is_clone boolean, clf_confidence real, clf_attack_intent text, clf_clone_tactic text, brand_category text, due_total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  SELECT
    sca.id, sca.candidate_domain, sca.candidate_url, sca.lifecycle_state,
    sca.urlscan_classification, sca.recheck_count, sca.last_rechecked_at,
    sca.signals, sca.attribution, cwc.is_clone, cwc.confidence,
    cwc.attack_intent, cwc.clone_tactic, kb.brand_category,
    -- v328: rows due in total, computed over the filtered set BEFORE the
    -- LIMIT — the backlog the batch cap leaves, on every returned row.
    pg_catalog.count(*) OVER () AS due_total
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN LATERAL (
    SELECT kb2.brand_category FROM public.known_brands kb2
    WHERE kb2.brand_domain = sca.inferred_target_domain LIMIT 1
  ) kb ON true
  -- v330: is this a not-a-clone audit sample still judged is_clone=false?
  LEFT JOIN LATERAL (
    SELECT (cwc.is_clone IS FALSE AND EXISTS (
      SELECT 1 FROM public.clone_watch_not_a_clone_samples nac
      WHERE nac.alert_id = sca.id
    )) AS nac_audit
  ) aud ON true
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    -- v326: dead-domain dormancy (see header). Same predicate as
    -- count_clone_recheck_dormant_dead below — change both together.
    AND NOT (
      sca.urlscan_uuid IS NULL
      AND sca.urlscan_failure_streak >= 8
      AND COALESCE(sca.urlscan_evidence ->> 'status', '') = '400'
    )
    AND (
      -- v330: an audit sample's clock starts at its audit scan, so a freshly
      -- scanned sample does not jump the NULL-first queue.
      (CASE WHEN aud.nac_audit THEN COALESCE(sca.last_rechecked_at, sca.urlscan_scanned_at)
            ELSE sca.last_rechecked_at END) IS NULL
      OR (CASE WHEN aud.nac_audit THEN COALESCE(sca.last_rechecked_at, sca.urlscan_scanned_at)
               ELSE sca.last_rechecked_at END)
         < pg_catalog.now() - pg_catalog.make_interval(
             hours => CASE
               WHEN sca.urlscan_evidence ->> 'status' = '400'
                 THEN GREATEST(1, p_dead_cadence_hours)
               -- v330: sampled not-a-clones are low-yield — weekly.
               WHEN aud.nac_audit
                 THEN GREATEST(p_cadence_hours, 168)
               -- v317: a row rechecked 8+ times without leaving the pool has
               -- shown nothing to watch for; weekly, not every 6 h.
               WHEN sca.recheck_count >= 8
                 THEN GREATEST(p_cadence_hours, 168)
               -- v326: older than 45 days → daily (79% of flips happen earlier).
               WHEN sca.first_seen_at < pg_catalog.now() - pg_catalog.make_interval(days => 45)
                 THEN GREATEST(p_cadence_hours, 24)
               ELSE GREATEST(1, p_cadence_hours)
             END
           )
    )
  ORDER BY (CASE WHEN aud.nac_audit THEN COALESCE(sca.last_rechecked_at, sca.urlscan_scanned_at)
                 ELSE sca.last_rechecked_at END) ASC NULLS FIRST,
           sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

COMMENT ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) IS
  'Recheck worklist (clone-watch-lifecycle-recheck): monitoring/declined NRD alerts < 90 days, dead-dormant held out (v326), due by the cadence CASE, stalest first, LIMIT clamped to 500. due_total = rows due before the LIMIT (v328). Sampled not-a-clones (v330) run weekly, clocked from their audit scan.';

REVOKE ALL ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) TO service_role;

COMMIT;
