-- migration-v224-clone-recheck-convergence.sql
--
-- Fixes the recheck-loop convergence + streak defects the ultracode ops
-- review found (2026-07-12). Before this, the recheck loop was 81% inert:
-- rescans of already-classified rows submitted to urlscan but could never be
-- retrieved (retrieve required urlscan_classification IS NULL, and the submit
-- RPC never clears it), so ~665/825 pool rows had their rescan verdicts
-- stranded and the parked->phishing flip the loop exists to catch was
-- undetectable for exactly the classified rows most likely to flip.
--
-- All CREATE OR REPLACE, same signatures/return shapes → no drops.

-- ── 1. Retrieve worklist: a fresh rescan supersedes the stale scan ──────────
-- Widen the gate so a row RESUBMITTED since its last successful scan
-- (urlscan_submitted_at > urlscan_scanned_at) is retrievable again, even
-- though it already carries an old classification. Non-destructive — the live
-- classification (read by the report + reporter evidence gate) is untouched;
-- persist_clone_alert_urlscan stamps urlscan_scanned_at on retrieval so the
-- row self-clears out of the worklist afterward. ~477 stranded rows become
-- retrievable immediately.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(
  p_limit integer DEFAULT 30,
  p_min_age_minutes integer DEFAULT 10,
  p_max_failure_streak integer DEFAULT 3
)
RETURNS TABLE(id bigint, candidate_url text, candidate_domain text, urlscan_uuid text, urlscan_evidence jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.urlscan_uuid,
    sca.urlscan_evidence
  FROM public.shopfront_clone_alerts sca
  WHERE sca.urlscan_uuid IS NOT NULL
    AND (
      sca.urlscan_classification IS NULL
      OR sca.urlscan_submitted_at > COALESCE(sca.urlscan_scanned_at, 'epoch'::timestamptz)
    )
    AND sca.urlscan_failure_streak < p_max_failure_streak
    AND sca.urlscan_submitted_at <= now() - (p_min_age_minutes * interval '1 minute')
  ORDER BY sca.urlscan_submitted_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

-- ── 2. Submit RPC: a successful resubmit resets the failure streak ──────────
-- A reachable resubmit (new uuid) means the row is up now — stale submit
-- failures are irrelevant. Without this, rows frozen at streak>=3 (65 in prod)
-- can never re-enter submit OR retrieve (the streak only reset on a retrieval
-- the gate itself prevented) — a permanent treadmill.
CREATE OR REPLACE FUNCTION public.record_clone_alert_urlscan_submit(
  p_alert_id bigint,
  p_urlscan_uuid text,
  p_evidence jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.shopfront_clone_alerts sca
  SET urlscan_uuid = COALESCE(p_urlscan_uuid, sca.urlscan_uuid),
      urlscan_submitted_at = now(),
      urlscan_evidence = COALESCE(p_evidence, sca.urlscan_evidence),
      urlscan_failure_streak = CASE
        WHEN p_urlscan_uuid IS NULL THEN sca.urlscan_failure_streak + 1
        ELSE 0  -- successful submit → clear stale failures (v224)
      END
  WHERE sca.id = p_alert_id;
END;
$function$;

-- ── 3. Recheck worklist: bound the monotonically-growing pool ───────────────
-- Never-flipping year-old parked domains were rescanned forever (the v199/v223
-- worklist dropped the age window the old v169 rescan RPC had). Cap eligibility
-- at 90 days from first_seen_at so the daily rescan budget goes to fresh
-- domains, not a growing pile of stale ones.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_recheck(
  p_limit int DEFAULT 50,
  p_cadence_hours int DEFAULT 6
)
RETURNS TABLE (
  id bigint,
  candidate_domain text,
  candidate_url text,
  lifecycle_state text,
  urlscan_classification text,
  recheck_count int,
  last_rechecked_at timestamptz,
  signals jsonb,
  attribution jsonb,
  clf_is_clone boolean,
  clf_confidence real,
  clf_attack_intent text,
  clf_clone_tactic text,
  brand_category text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    sca.id,
    sca.candidate_domain,
    sca.candidate_url,
    sca.lifecycle_state,
    sca.urlscan_classification,
    sca.recheck_count,
    sca.last_rechecked_at,
    sca.signals,
    sca.attribution,
    cwc.is_clone,
    cwc.confidence,
    cwc.attack_intent,
    cwc.clone_tactic,
    kb.brand_category
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN LATERAL (
    SELECT kb2.brand_category
    FROM public.known_brands kb2
    WHERE kb2.brand_domain = sca.inferred_target_domain
    LIMIT 1
  ) kb ON true
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    AND (
      sca.last_rechecked_at IS NULL
      OR sca.last_rechecked_at
         < pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_cadence_hours))
    )
  ORDER BY sca.last_rechecked_at ASC NULLS FIRST, sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(int, int)
  FROM PUBLIC, anon, authenticated;

-- ── 4. Reconciler worklist: round-robin so mid-window uuids aren't starved ──
-- Was ORDER BY min(submitted_at) ASC — the oldest ~24 uuids owned all 12 daily
-- slots and newer uuids only reconciled once the old ones aged past 30 days,
-- so a mid-window clone that turned malicious got its taken_down/takedown_at
-- stamp weeks late or never. Round-robin on reconciled_at (never-reconciled
-- first, then least-recently) gives every uuid a turn within ~N/12 days.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_netcraft_reconcile(
  p_max_age_days integer DEFAULT 30,
  p_uuid_limit integer DEFAULT 60,
  p_cadence_hours integer DEFAULT 24
)
RETURNS TABLE(netcraft_uuid text, alerts jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH pending AS (
    SELECT
      sca.submitted_to -> 'netcraft' ->> 'uuid' AS uuid,
      (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz AS submitted_at,
      (sca.submitted_to -> 'netcraft' ->> 'reconciled_at')::timestamptz AS reconciled_at,
      pg_catalog.jsonb_build_object(
        'id', sca.id,
        'candidate_domain', sca.candidate_domain,
        'candidate_url', sca.candidate_url,
        'lifecycle_state', sca.lifecycle_state
      ) AS alert
    FROM public.shopfront_clone_alerts sca
    WHERE sca.submitted_to ? 'netcraft'
      AND sca.submitted_to -> 'netcraft' ->> 'uuid' IS NOT NULL
      AND sca.lifecycle_state IN ('detected', 'monitoring', 'reported', 'declined')
      AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= pg_catalog.now() - (p_max_age_days || ' days')::interval
      AND (
        (sca.submitted_to -> 'netcraft' ->> 'reconciled_at') IS NULL
        OR (sca.submitted_to -> 'netcraft' ->> 'reconciled_at')::timestamptz
             <= pg_catalog.now() - (p_cadence_hours || ' hours')::interval
      )
  )
  SELECT
    p.uuid,
    pg_catalog.jsonb_agg(p.alert ORDER BY (p.alert ->> 'id')::bigint)
  FROM pending p
  GROUP BY p.uuid
  -- Round-robin: never-reconciled uuids first, then least-recently reconciled.
  ORDER BY min(p.reconciled_at) ASC NULLS FIRST, min(p.submitted_at) ASC
  LIMIT GREATEST(1, p_uuid_limit);
$function$;
