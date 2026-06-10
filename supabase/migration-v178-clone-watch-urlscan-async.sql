-- v178 — clone-watch urlscan async-pipeline rebuild
--
-- Splits the old per-candidate submit→sleep→retrieve monolith (which timed out
-- 100% of the time because urlscan's free tier queues fresh-NRD scans far
-- longer than the 90s in-run wait) into two batched cron stages:
--   submit  → fire-and-store the urlscan UUID, no wait
--   retrieve→ a later batch cron fetches results that are now ready
-- gated on the Haiku preclassifier (only scan likely-clones) and capped on
-- failure_streak so dead candidates aren't re-scanned forever.
--
-- Idempotent / re-appliable. No data backfill — new column defaults NULL.

-- ── 1. Lifecycle column ─────────────────────────────────────────────────────
-- urlscan_submitted_at = when we submitted to urlscan (distinct from
-- urlscan_scanned_at = when we last *retrieved*). Lets the retrieve stage find
-- "submitted but not yet classified" rows and enforce a min-age before polling.
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS urlscan_submitted_at timestamptz;

-- Partial index supporting the retrieve-pending scan. Tiny + partial (only rows
-- mid-flight), and shopfront_clone_alerts is low-write (~30 inserts/day), so
-- this is nowhere near the hot-table index policy ceiling.
CREATE INDEX IF NOT EXISTS idx_clone_alerts_urlscan_awaiting_retrieve
  ON public.shopfront_clone_alerts (urlscan_submitted_at)
  WHERE urlscan_uuid IS NOT NULL AND urlscan_classification IS NULL;

-- ── 2. Submit-pending list (the gate) ───────────────────────────────────────
-- Only surfaces NRD candidates the Haiku preclassifier judged a likely clone
-- (is_clone AND confidence >= threshold), not yet submitted, under the failure
-- cap, and recent. This is what cuts the urlscan volume to candidates worth the
-- scan instead of every low-severity lexical match.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan_submit(
  p_limit integer DEFAULT 30,
  p_min_confidence real DEFAULT 0.7,
  p_max_failure_streak integer DEFAULT 3
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text
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
    sca.inferred_target_domain
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.urlscan_uuid IS NULL
    AND sca.urlscan_failure_streak < p_max_failure_streak
    AND sca.first_seen_at >= now() - interval '14 days'
    AND EXISTS (
      SELECT 1
      FROM public.clone_watch_classifications c
      WHERE c.alert_id = sca.id
        AND c.is_clone
        AND c.confidence >= p_min_confidence
    )
  ORDER BY sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

-- ── 3. Record a submit ──────────────────────────────────────────────────────
-- Stores the urlscan UUID + submitted_at + the synchronous SB/VT reputation
-- evidence captured at submit time. Does NOT touch urlscan_scanned_at or
-- urlscan_classification (those belong to the retrieve stage). A NULL uuid
-- means submit itself failed → bump the failure streak so it ages out.
CREATE OR REPLACE FUNCTION public.record_clone_alert_urlscan_submit(
  p_alert_id bigint,
  p_urlscan_uuid text,
  p_evidence jsonb DEFAULT NULL
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
        ELSE sca.urlscan_failure_streak
      END
  WHERE sca.id = p_alert_id;
END;
$function$;

-- ── 4. Retrieve-pending list ────────────────────────────────────────────────
-- Rows that have a UUID, no classification yet, are under the failure cap, and
-- were submitted at least p_min_age_minutes ago (gives urlscan time to finish
-- the render before we poll — the whole point of the rebuild). Returns the
-- stored reputation evidence so the retrieve stage can merge SB/VT + urlscan
-- into one classification.
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
  WHERE sca.urlscan_uuid IS NOT NULL
    AND sca.urlscan_classification IS NULL
    AND sca.urlscan_failure_streak < p_max_failure_streak
    AND sca.urlscan_submitted_at <= now() - (p_min_age_minutes * interval '1 minute')
  ORDER BY sca.urlscan_submitted_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

-- ── 5. Lock down EXECUTE ─────────────────────────────────────────────────────
-- Supabase auto-grants EXECUTE to PUBLIC on every CREATE FUNCTION. These are
-- service-role-only helpers; revoke from PUBLIC (which covers anon+authenticated
-- and the implicit public grant the v152 audit caught).
REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan_submit(integer, real, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_clone_alert_urlscan_submit(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(integer, integer, integer) FROM PUBLIC, anon, authenticated;
