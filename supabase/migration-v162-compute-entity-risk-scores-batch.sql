-- migration-v162-compute-entity-risk-scores-batch.sql
--
-- Set-based wrapper over compute_entity_risk_score (cron-hardening #520 M-risk).
--
-- ROOT CAUSE: the risk-scorer cron called the single-entity RPC
-- compute_entity_risk_score(bigint) in a JS for-loop — up to
-- MAX_ENTITIES_PER_RUN = 100 separate network round-trips every 6h.
--
-- FIX: wrap the EXACT same per-entity logic in one server-side call. The
-- scoring formula is untouched — this only moves the loop from the app into
-- PL/pgSQL, collapsing 100 round-trips to 1. Per-entity failures are isolated
-- (BEGIN/EXCEPTION) so one bad row doesn't abort the batch, matching the JS
-- loop's try/catch semantics. Returns a {scored, failed} summary.
--
-- SECURITY DEFINER + service_role-only (single caller is the service-role
-- Inngest client). REVOKE FROM PUBLIC per the v160/#512 lesson.
-- search_path = '' with fully-qualified refs per supabase/CLAUDE.md §4. The
-- inner public.compute_entity_risk_score is fully qualified and runs under its
-- OWN configured search_path (functions don't inherit the caller's), so the
-- empty path here doesn't affect it; json_build_object/array_length are
-- pg_catalog builtins (implicitly searched under '').
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT are safe to re-run.

CREATE OR REPLACE FUNCTION public.compute_entity_risk_scores(
  p_entity_ids BIGINT[]
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id BIGINT;
  v_res JSON;
  v_scored INT := 0;
  v_failed INT := 0;
BEGIN
  IF p_entity_ids IS NULL OR array_length(p_entity_ids, 1) IS NULL THEN
    RETURN json_build_object('scored', 0, 'failed', 0);
  END IF;

  FOREACH v_id IN ARRAY p_entity_ids LOOP
    BEGIN
      v_res := public.compute_entity_risk_score(v_id);
      IF (v_res ->> 'error') IS NOT NULL THEN
        v_failed := v_failed + 1;
      ELSE
        v_scored := v_scored + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN json_build_object('scored', v_scored, 'failed', v_failed);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_entity_risk_scores(BIGINT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_entity_risk_scores(BIGINT[])
  TO service_role;
