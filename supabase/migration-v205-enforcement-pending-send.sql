-- v205 — enforcement auto-send worklist RPC
--        (Wave 1 outbound execution of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: the enforcement-execute step (auto-report to the reversible ecosystem
-- feeds APWG + OpenPhish) needs the queued, AUTO-autonomy cases to send. Only
-- 'auto' channels are ever sent by machine — the itch.io false-takedown
-- invariant keeps every domain-level lever (registrar/host/UDRP) human-gated.
-- Read-only, service_role only. Idempotent.

CREATE OR REPLACE FUNCTION public.list_enforcement_cases_pending_send(
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  case_id bigint,
  clone_alert_id bigint,
  channel text,
  candidate_url text,
  candidate_domain text,
  target_brand_normalized text,
  evidence_bundle jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    t.id,
    t.clone_alert_id,
    t.attempt_type,
    a.candidate_url,
    a.candidate_domain,
    a.target_brand_normalized,
    t.evidence_bundle
  FROM public.shopfront_takedown_attempts t
  JOIN public.shopfront_clone_alerts a ON a.id = t.clone_alert_id
  WHERE t.channel_autonomy = 'auto'          -- ONLY reversible ecosystem feeds
    AND t.attempt_type IN ('apwg', 'openphish')
    AND t.case_status = 'queued'
    -- only act on a lookalike our scanner actually confirmed weaponised
    AND a.lifecycle_state = 'weaponised'
  ORDER BY t.created_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

REVOKE EXECUTE ON FUNCTION public.list_enforcement_cases_pending_send(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_enforcement_cases_pending_send(int)
  TO service_role;

-- Shared daily submission counter — the F2 guard. Counts today's outbound
-- reports across BOTH the Netcraft submit path and clone-enforcement, so a
-- single global cap protects the reporter reputation no matter which path fires.
-- Reuses cost_telemetry as the durable counter (no new table).
CREATE OR REPLACE FUNCTION public.count_todays_takedown_submissions()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT COALESCE(sum(units), 0)::int
  FROM public.cost_telemetry
  WHERE created_at >= date_trunc('day', now())
    AND (
      (feature = 'clone_enforcement' AND operation = 'enforcement.reported')
      OR (feature = 'shopfront_clone_submit_netcraft')
    );
$$;

REVOKE EXECUTE ON FUNCTION public.count_todays_takedown_submissions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_todays_takedown_submissions()
  TO service_role;
