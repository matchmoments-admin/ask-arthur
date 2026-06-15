-- migration-v185-netcraft-auto-daily-cap.sql
--
-- PHASE 8 — make Netcraft auto-report safe (no flooding).
--
-- Replaces list_clone_alerts_pending_netcraft_auto (v184) with two changes:
--   1. DAILY CAP folded in. The function now counts how many clones were
--      auto-bulk-submitted to Netcraft in the last 24h (submitted_to.netcraft.via
--      = 'auto_bulk') and returns at most (p_daily_cap - that count), hard-capped
--      at 50. So even if the producer's manual-trigger is fired repeatedly, the
--      RPC structurally cannot return more than the day's remaining budget — no
--      flood is possible from the DB side.
--   2. BEST-FIRST ordering. Orders by the preclassifier confidence DESC (then
--      first_seen_at DESC), so within the daily cap the highest-confidence clones
--      are reported first.
--
-- Signature change: drops p_limit, adds p_daily_cap. Same return shape.
--
-- Idempotent CREATE OR REPLACE. SECURITY DEFINER; EXECUTE revoked from
-- PUBLIC/anon/authenticated (service-role producer only). The old 2-arg
-- (integer, real) overload from v184 is dropped so only the capped version
-- exists.

DROP FUNCTION IF EXISTS public.list_clone_alerts_pending_netcraft_auto(integer, real);

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_auto(
  p_min_confidence real DEFAULT 0.7,
  p_daily_cap integer DEFAULT 50
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  severity_tier text,
  signals jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH today AS (
    SELECT count(*)::int AS n
    FROM public.shopfront_clone_alerts
    WHERE submitted_to -> 'netcraft' ->> 'via' = 'auto_bulk'
      AND (submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            > now() - interval '24 hours'
  )
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.severity_tier,
    sca.signals
  FROM public.shopfront_clone_alerts sca
  WHERE sca.inferred_target_domain IS NOT NULL
    AND NOT (sca.submitted_to ? 'netcraft')
    AND COALESCE(sca.triage_status, '') <> 'fp'
    AND lower(sca.inferred_target_domain) NOT IN
      ('domain.com.au', 'allhomes.com.au', 'lendi.com.au')
    AND sca.first_seen_at >= now() - interval '180 days'
    AND EXISTS (
      SELECT 1
      FROM public.clone_watch_classifications c
      WHERE c.alert_id = sca.id
        AND c.is_clone
        AND c.confidence >= p_min_confidence
    )
  ORDER BY
    (SELECT max(c.confidence)
       FROM public.clone_watch_classifications c
       WHERE c.alert_id = sca.id AND c.is_clone) DESC NULLS LAST,
    sca.first_seen_at DESC
  LIMIT LEAST(
    GREATEST(0, p_daily_cap - (SELECT n FROM today)),
    50
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_auto(real, integer)
  FROM PUBLIC, anon, authenticated;
