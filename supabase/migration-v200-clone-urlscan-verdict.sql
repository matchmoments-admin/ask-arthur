-- v200 — clone-alert urlscan verdict → lifecycle transition
--        (Wave 0 PR-B of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: v199 gave shopfront_clone_alerts a lifecycle_state and the guarded
-- advance_clone_lifecycle() primitive. The re-check loop (this PR) re-scans
-- monitoring/declined domains via urlscan; when OUR scanner sees the phish
-- (urlscan_classification='likely_phishing') the alert must transition to
-- 'weaponised' — that is the contradiction we exploit ("we saw it, Netcraft
-- didn't") to re-press a declined lookalike.
--
-- But the raw advance_clone_lifecycle() sets any target unconditionally, which
-- would let an out-of-order urlscan result DOWNGRADE a 'reported' alert back to
-- 'monitoring', or RESURRECT a terminal 'taken_down' one. This RPC encodes the
-- ALLOWED EDGES from a urlscan verdict and serialises the read-modify-write with
-- SELECT ... FOR UPDATE, so a concurrent advance_clone_lifecycle (submit→reported,
-- poll→declined/taken_down) on the same alert can't clobber it with a stale read
-- — the edge-guard would be meaningless otherwise. It reports whether it newly
-- weaponised so the caller can emit shopfront/clone.weaponised.v1 once per change.
--
-- Edges:
--   likely_phishing + state ∈ {detected,monitoring,declined} → weaponised
--   {parked_for_sale,neutral,unresolved} + state = detected   → monitoring
--   otherwise                                                 → no-op
-- (A benign verdict never downgrades weaponised/reported/declined — a domain
--  that WAS phishing and now shows parked is likely cloaking, not cleared.)
--
-- Idempotent: CREATE OR REPLACE only. No table/column changes.

CREATE OR REPLACE FUNCTION public.apply_clone_urlscan_verdict(
  p_alert_id bigint,
  p_classification text,
  p_evidence jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current text;
  v_next    text;
BEGIN
  -- FOR UPDATE locks the row so a concurrent advance_clone_lifecycle serialises
  -- behind us — otherwise a stale read here could blindly overwrite a fresher
  -- state written between this SELECT and the UPDATE below.
  SELECT lifecycle_state INTO v_current
  FROM public.shopfront_clone_alerts
  WHERE id = p_alert_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RETURN NULL; -- no such alert
  END IF;

  IF p_evidence IS NOT NULL AND jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'apply_clone_urlscan_verdict: p_evidence must be a jsonb object, got %',
      jsonb_typeof(p_evidence) USING ERRCODE = '22023';
  END IF;

  IF p_classification = 'likely_phishing'
     AND v_current IN ('detected', 'monitoring', 'declined') THEN
    v_next := 'weaponised';
  ELSIF p_classification IN ('parked_for_sale', 'neutral', 'unresolved')
     AND v_current = 'detected' THEN
    v_next := 'monitoring';
  ELSE
    v_next := v_current; -- no allowed transition for this (verdict, state) pair
  END IF;

  -- Write only when something actually changes (state moved, or evidence to merge).
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
    'newly_weaponised', (v_next = 'weaponised' AND v_current <> 'weaponised')
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.apply_clone_urlscan_verdict(bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_clone_urlscan_verdict(bigint, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.apply_clone_urlscan_verdict(bigint, text, jsonb) IS
  'v200: atomic edge-guarded lifecycle transition from a urlscan verdict. Returns {state, newly_weaponised}. See docs/plans/clone-watch-enforcement-and-monetisation.md Wave 0 PR-B.';
