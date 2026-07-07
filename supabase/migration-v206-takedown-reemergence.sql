-- v206 — takedown re-emergence monitoring
--        (Wave 1 of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: a taken-down clone can come back on new hosting. The enforcement case
-- model is only audit-ready if it captures that — "we actioned it, it came
-- back, we re-actioned". This adds the worklist RPC + the checked/marker RPC the
-- re-emergence cron uses. Read/write helpers, service_role only. Idempotent.

-- Worklist: 'actioned' cases whose re-emergence re-check cadence has elapsed.
CREATE OR REPLACE FUNCTION public.list_takedown_cases_for_reemergence(
  p_limit int DEFAULT 50,
  p_cadence_hours int DEFAULT 24
)
RETURNS TABLE (
  case_id bigint,
  clone_alert_id bigint,
  candidate_domain text,
  channel text,
  last_reemergence_check_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    t.id, t.clone_alert_id, a.candidate_domain, t.attempt_type,
    t.last_reemergence_check_at
  FROM public.shopfront_takedown_attempts t
  JOIN public.shopfront_clone_alerts a ON a.id = t.clone_alert_id
  WHERE t.case_status = 'actioned'
    AND (
      t.last_reemergence_check_at IS NULL
      OR t.last_reemergence_check_at < now() - make_interval(hours => GREATEST(1, p_cadence_hours))
    )
  ORDER BY t.last_reemergence_check_at ASC NULLS FIRST
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.list_takedown_cases_for_reemergence(int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_takedown_cases_for_reemergence(int, int)
  TO service_role;

-- Marker: stamp the check; if the domain resolved again, reopen the case as
-- 're_emerged' and set next_action_at so it surfaces at the top of the worklist.
CREATE OR REPLACE FUNCTION public.mark_takedown_reemergence_checked(
  p_case_id bigint,
  p_reemerged boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.shopfront_takedown_attempts
  SET last_reemergence_check_at = now(),
      case_status = CASE WHEN p_reemerged THEN 're_emerged' ELSE case_status END,
      next_action_at = CASE WHEN p_reemerged THEN now() ELSE next_action_at END,
      updated_at = now()
  WHERE id = p_case_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.mark_takedown_reemergence_checked(bigint, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_takedown_reemergence_checked(bigint, boolean)
  TO service_role;
