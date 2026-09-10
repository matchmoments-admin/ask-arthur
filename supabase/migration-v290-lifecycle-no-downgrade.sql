-- Migration v290 — advance_clone_lifecycle stops accepting illegal transitions.
--
-- WHY. v199's advance_clone_lifecycle validates only that the TARGET is a legal
-- state. It never checks the (from, to) pair, so it is ANY -> ANY. Meanwhile
-- apply_netcraft_reconcile (v249) implements a no-downgrade rule, and
-- apps/web/lib/clone-watch/lifecycle.ts (v288) documents the edge set. Only two
-- of the three actually enforce anything.
--
-- The reachable defect: clone-watch-submit-netcraft.ts:176 calls
--
--     advance_clone_lifecycle(alertId, 'reported')
--
-- unconditionally after a manual triage submission. Run that on a WEAPONISED
-- alert and it downgrades to 'reported', which:
--   * drops it out of the resubmit lane (WHERE lifecycle_state = 'weaponised')
--   * drops it out of the issue lane's weaponised disjunct
--   * leaves weaponised_at stamped (first-touch COALESCE), so the timestamp
--     outlives the state and the inconsistency is HARDER to notice, not easier
--
-- Exposure today is low and that was measured, not assumed: `reported` has zero
-- rows and the manual submit lane last fired 2026-06-15. It is a latent hole,
-- not an active one — but it is the only reachable illegal transition left, and
-- v288 shipped a spec that claims it cannot happen.
--
-- THE RULE, taken verbatim from lifecycle.ts so the three encodings agree:
--   * taken_down / dormant are TERMINAL — only a same-state no-op is allowed
--   * weaponised exits ONLY to taken_down (the outcome the path exists for);
--     a later benign grade must never walk it back to declined/monitoring
--   * every other transition is unchanged
--
-- SAME-STATE CALLS STAY LEGAL, deliberately. v273's header records that the
-- recheck cron calls this with the row's own current state as a no-op, and
-- v278 exists because that no-op used to have side effects. Rejecting
-- same-state here would break that caller.
--
-- FAIL LOUD, consistent with v288's CHECK and with this function's own existing
-- style (it already RAISEs 22023 on an invalid target state and on a
-- non-object evidence payload). The one live caller treats the call as
-- best-effort and logs the error without throwing
-- (clone-watch-submit-netcraft.ts:180) — so a refused downgrade logs a warning
-- and leaves the successful Netcraft submission intact, which is exactly the
-- behaviour we want.
--
-- Signature, return type, security and search_path are all unchanged. The
-- search_path here is the INVOKER form (`public, pg_catalog`) on a SECURITY
-- DEFINER function, which contradicts supabase/CLAUDE.md — that is true of ~25
-- clone-watch functions and is being fixed separately in small batches, NOT
-- bundled here: changing security config and behaviour in one migration makes a
-- rollback ambiguous. Verified not exploitable meanwhile (no role can CREATE in
-- public; 0 of 53 clone-watch functions are executable by anon).
--
-- Idempotent: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.advance_clone_lifecycle(
  p_alert_id bigint,
  p_to_state text,
  p_evidence jsonb DEFAULT NULL::jsonb,
  p_mark_rechecked boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_current text;
BEGIN
  IF p_to_state NOT IN (
    'detected','monitoring','weaponised','reported','declined','taken_down','dormant'
  ) THEN
    RAISE EXCEPTION 'advance_clone_lifecycle: invalid target state %', p_to_state
      USING ERRCODE = '22023';
  END IF;
  IF p_evidence IS NOT NULL AND jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'advance_clone_lifecycle: p_evidence must be a jsonb object, got %',
      jsonb_typeof(p_evidence) USING ERRCODE = '22023';
  END IF;

  -- v290: refuse illegal (from, to) pairs. Mirrors apply_netcraft_reconcile's
  -- no-downgrade set and the edge table in lib/clone-watch/lifecycle.ts.
  SELECT lifecycle_state INTO v_current
  FROM public.shopfront_clone_alerts
  WHERE id = p_alert_id;

  IF v_current IS NOT NULL AND p_to_state <> v_current THEN
    IF v_current IN ('taken_down', 'dormant') THEN
      RAISE EXCEPTION
        'advance_clone_lifecycle: % is terminal; refusing move to % (alert %)',
        v_current, p_to_state, p_alert_id
        USING ERRCODE = '22023';
    ELSIF v_current = 'weaponised' AND p_to_state <> 'taken_down' THEN
      RAISE EXCEPTION
        'advance_clone_lifecycle: refusing to downgrade weaponised -> % (alert %); only taken_down moves a weaponised clone',
        p_to_state, p_alert_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.shopfront_clone_alerts
  SET lifecycle_state = p_to_state,
      weaponised_at = CASE WHEN p_to_state = 'weaponised'
                           THEN COALESCE(weaponised_at, now()) ELSE weaponised_at END,
      -- v273: FIRST decline wins. The recheck cron calls this with the row's own
      -- current state as a no-op, so an unguarded now() walked this clock
      -- forward every 6h and destroyed the decline->weaponise duration series.
      netcraft_declined_at = CASE WHEN p_to_state = 'declined'
                                  THEN COALESCE(netcraft_declined_at, now())
                                  ELSE netcraft_declined_at END,
      alert_state = CASE
                      WHEN p_to_state = 'taken_down' THEN 'taken_down'
                      WHEN p_to_state = 'dormant'    THEN 'expired'
                      ELSE alert_state
                    END,
      evidence = CASE WHEN p_evidence IS NULL THEN evidence ELSE evidence || p_evidence END,
      recheck_count = recheck_count + (CASE WHEN p_mark_rechecked THEN 1 ELSE 0 END),
      last_rechecked_at = CASE WHEN p_mark_rechecked THEN now() ELSE last_rechecked_at END,
      updated_at = now()
  WHERE id = p_alert_id;
END
$function$;

COMMENT ON FUNCTION public.advance_clone_lifecycle(bigint, text, jsonb, boolean) IS
  'The guarded lifecycle transition (v199). v290: refuses illegal (from,to) pairs — terminal states accept only a same-state no-op, and weaponised exits only to taken_down. Same-state calls stay legal (the recheck cron relies on it, v273/v278). Edge set: apps/web/lib/clone-watch/lifecycle.ts.';
