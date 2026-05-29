-- v169: Clone-watch urlscan — failure-streak guard (runaway root-fix, Inngest PR-A)
--
-- CONTEXT. The clone-watch urlscan consumer (apps/web/app/api/inngest/functions/
-- clone-watch-urlscan.ts) persists a stub with `urlscan_scanned_at = now()` on
-- BOTH failure paths (submit_failed :117, retrieval_timeout :181) so the row
-- re-qualifies for the daily rescan cron (issue #441 — without the timestamp the
-- row was stuck forever). The side effect: a URL that fails *every* scan keeps
-- re-qualifying for the full 60-day rescan window (v149), so a growing pool of
-- permanently-failing alerts burns urlscan + Inngest executions daily. Combined
-- with the now-fixed Date.now() dedup-defeat (PR-J #518), that pool drove the
-- May 27–29 execution burst.
--
-- FIX. Track consecutive scan failures per alert and drop a row off the rescan
-- path after 3 straight failures. Failure is detected by p_classification IS NULL
-- — the consumer passes a non-null classification ONLY on a successful retrieval
-- (classifyScan always returns one of 4 non-null strings); both failure paths
-- pass p_classification = NULL. A later successful scan resets the streak to 0.
-- The operator can still see the row in the admin dashboard; it just stops
-- auto-burning scan budget.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Both functions are
-- re-hardened to SECURITY DEFINER + search_path = '' (the v160 deferred item —
-- safe here because every reference is already schema-qualified) and the full
-- REVOKE ... FROM PUBLIC, anon, authenticated (the v160 lesson: Supabase
-- auto-grants EXECUTE to PUBLIC; revoking only anon/authenticated leaves the
-- inherited PUBLIC grant intact).

-- 1. Per-alert consecutive-failure counter. Existing rows default to 0, so they
--    all pass the new `< 3` rescan filter — no backfill needed.
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS urlscan_failure_streak int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.shopfront_clone_alerts.urlscan_failure_streak IS
  'Consecutive failed urlscan attempts (submit_failed / retrieval_timeout). Reset to 0 on a successful scan. list_clone_alerts_for_urlscan_rescan drops rows at >= 3 so a permanently-failing URL stops re-qualifying for the daily rescan.';

-- 2. persist_clone_alert_urlscan — add streak maintenance. Body is otherwise
--    identical to v148. Failure (p_classification IS NULL) increments the
--    streak; a successful scan resets it to 0.
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

  RETURN QUERY
  UPDATE public.shopfront_clone_alerts sca
  SET urlscan_uuid = COALESCE(p_urlscan_uuid, sca.urlscan_uuid),
      urlscan_evidence = COALESCE(p_urlscan_evidence, sca.urlscan_evidence),
      urlscan_classification = COALESCE(p_classification, sca.urlscan_classification),
      urlscan_scanned_at = now(),
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  TO service_role;

COMMENT ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text) IS
  'Persist urlscan.io scan result + auto-classification. Never demotes an operator-triaged row (tp_confirmed/tp_actioned/fp). Maintains urlscan_failure_streak: +1 on a failed scan (classification NULL), reset to 0 on success.';

-- 3. list_clone_alerts_for_urlscan_rescan — drop rows that have failed 3+ times
--    in a row. Body is otherwise identical to v149 (60-day window).
CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_urlscan_rescan(
  p_limit int DEFAULT 50,
  p_stale_after_hours int DEFAULT 24
)
RETURNS TABLE (
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  previous_classification text,
  last_scanned_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.urlscan_classification AS previous_classification,
    sca.urlscan_scanned_at AS last_scanned_at
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.triage_status IN ('pending', 'needs_investigation')
    AND sca.urlscan_scanned_at IS NOT NULL
    AND sca.urlscan_scanned_at < now() - (
      GREATEST(1, LEAST(p_stale_after_hours, 168)) * interval '1 hour'
    )
    -- 60-day window (v149) for slow-burn seasoning attackers.
    AND sca.first_seen_at >= now() - interval '60 days'
    -- Drop rows that have failed 3+ scans in a row (v169) so a permanently
    -- failing URL stops re-qualifying every day and burning scan budget.
    AND sca.urlscan_failure_streak < 3
  ORDER BY sca.urlscan_scanned_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_urlscan_rescan(int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_urlscan_rescan(int, int)
  TO service_role;
