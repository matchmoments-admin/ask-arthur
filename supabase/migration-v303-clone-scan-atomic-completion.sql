-- v303: successful scan completion and lifecycle are one transaction.
-- Failed attempts retain the last successful scan clock and classification.
-- Idempotent replacement; no data backfill or table rewrite. Roll back by
-- reapplying the v230 function definition (restores the known failure modes).
BEGIN;
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.persist_clone_alert_urlscan(
  p_alert_id bigint,
  p_urlscan_uuid text,
  p_urlscan_evidence jsonb,
  p_classification text,
  p_set_triage_status text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  urlscan_classification text,
  triage_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_found boolean;
  v_prior_classification text;
  v_prior_evidence jsonb;
  v_prior_lifecycle_state text;
  v_prior_urlscan_submitted_at timestamptz;
BEGIN
  IF p_classification IS NOT NULL
     AND p_classification NOT IN ('parked_for_sale','unresolved','likely_phishing','neutral') THEN
    RAISE EXCEPTION 'invalid urlscan classification: %', p_classification
      USING ERRCODE = '22023';
  END IF;
  IF p_set_triage_status IS NOT NULL
     AND p_set_triage_status NOT IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned') THEN
    RAISE EXCEPTION 'invalid triage status: %', p_set_triage_status USING ERRCODE = '22023';
  END IF;

  -- Snapshot prior values under the row lock. FOR UPDATE serialises this fn
  -- with apply_clone_urlscan_verdict (v200), which locks the same row.
  SELECT sca.urlscan_classification, sca.urlscan_evidence,
         sca.lifecycle_state, sca.urlscan_submitted_at
    INTO v_prior_classification, v_prior_evidence,
         v_prior_lifecycle_state, v_prior_urlscan_submitted_at
    FROM public.shopfront_clone_alerts sca
   WHERE sca.id = p_alert_id
     FOR UPDATE;
  v_found := FOUND;

  RETURN QUERY
  UPDATE public.shopfront_clone_alerts sca
  SET urlscan_uuid = COALESCE(p_urlscan_uuid, sca.urlscan_uuid),
      urlscan_evidence = COALESCE(p_urlscan_evidence, sca.urlscan_evidence),
      urlscan_classification = COALESCE(p_classification, sca.urlscan_classification),
      -- A failed rescan must remain newer than the last completed scan.
      urlscan_scanned_at = CASE WHEN p_classification IS NOT NULL
                               THEN now() ELSE sca.urlscan_scanned_at END,
      -- A null classification means the scan failed (submit_failed /
      -- retrieval_timeout). Count the streak; a successful scan resets it.
      urlscan_failure_streak = CASE
        WHEN p_classification IS NULL THEN sca.urlscan_failure_streak + 1
        ELSE 0
      END,
      -- Never demote: if a row is already tp_confirmed/tp_actioned/fp,
      -- the operator has decided — don't let auto-classify revert it.
      -- Only apply the suggested transition when the row is still pending
      -- or needs_investigation.
      triage_status = CASE
        WHEN sca.triage_status IN ('tp_confirmed','tp_actioned','fp')
          THEN sca.triage_status
        WHEN p_set_triage_status IS NULL
          THEN sca.triage_status
        ELSE p_set_triage_status
      END
  WHERE sca.id = p_alert_id
  RETURNING sca.id, sca.urlscan_classification, sca.triage_status;

  -- Transition-only archive (v230). Guarded on v_found so a nonexistent
  -- alert id stays the silent no-op it always was (no FK violation).
  IF v_found
     AND p_classification IS NOT NULL
     AND p_classification IS DISTINCT FROM v_prior_classification THEN
    INSERT INTO public.clone_watch_scan_transitions
      (alert_id, prior_classification, new_classification,
       prior_evidence, new_evidence, lifecycle_state_at_scan,
       urlscan_uuid, urlscan_submitted_at, scanned_at)
    VALUES
      (p_alert_id, v_prior_classification, p_classification,
       v_prior_evidence, p_urlscan_evidence, v_prior_lifecycle_state,
       p_urlscan_uuid, v_prior_urlscan_submitted_at, now())
    ON CONFLICT (alert_id, COALESCE(urlscan_uuid, ''), new_classification)
    DO NOTHING;
  END IF;
  -- Same transaction and row lock as the verdict/archive write. Any failure
  -- rolls everything back, keeping this submission eligible for retrieval.
  IF v_found AND p_classification IS NOT NULL THEN
    PERFORM public.apply_clone_urlscan_verdict(p_alert_id, p_classification);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  TO service_role;


COMMENT ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text) IS
  'v303: atomic successful verdict, archive and lifecycle. Misses retain the successful scan clock; failure streak remains bounded.';

-- Backward-compatible worklist repair: no historical evidence is rewritten.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(
  p_limit integer DEFAULT 30,
  p_min_age_minutes integer DEFAULT 10,
  p_max_failure_streak integer DEFAULT 3
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  urlscan_uuid text,
  urlscan_evidence jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.urlscan_uuid,
    sca.urlscan_evidence
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'                    -- v275: both siblings pin this
    AND sca.urlscan_uuid IS NOT NULL
    AND (
      sca.urlscan_classification IS NULL
      -- v224: a rescan submitted since the last successful scan supersedes it.
      OR sca.urlscan_submitted_at > COALESCE(sca.urlscan_scanned_at, 'epoch'::timestamptz)
      -- Recover legacy failed rescans without inventing or erasing timestamps.
      -- Reputation-only successful classifications also use retrieve_pending,
      -- so only an explicitly non-malicious reputation miss is pending here.
      OR (sca.urlscan_evidence ->> 'stage' = 'retrieve_pending'
          AND sca.urlscan_evidence #>> '{reputation,is_malicious}' = 'false')
    )
    AND sca.urlscan_failure_streak < p_max_failure_streak
    -- v275: fall back to the scan clock. An unguarded `urlscan_submitted_at <=`
    -- yields NULL (not false) for a row with a uuid and no submit timestamp, so
    -- 193 alerts were filtered out of this worklist permanently.
    AND COALESCE(sca.urlscan_submitted_at, sca.urlscan_scanned_at)
        <= now() - (p_min_age_minutes * interval '1 minute')
  ORDER BY COALESCE(sca.urlscan_submitted_at, sca.urlscan_scanned_at) ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(integer, integer, integer)
  TO service_role;


COMMIT;
