-- v278 — recheck bookkeeping must not write lifecycle_state.
--
-- CAUGHT IN PROD 2026-08-10 00:32, ~2h after v276/#990 shipped. Live instance:
-- alert 2272 (`qantasa.exchange`) was moved declined -> weaponised at 00:31:43
-- and read `lifecycle_state='declined'` again at 00:32:13. Thirty seconds.
--
-- The mechanism is a read-modify-write across two Inngest steps in
-- clone-watch-lifecycle-recheck:
--
--   step "load-recheck-candidates"  → reads lifecycle_state into `pool`
--   step "submit-batch"             → submitCloneCandidate(...) which, since
--                                     #990, calls apply_clone_urlscan_verdict
--                                     and CAN move declined -> weaponised
--   step "mark-rechecked"           → advance_clone_lifecycle(
--                                       p_to_state: c.lifecycle_state  ← STALE
--                                     )
--
-- The third step replays a value read before the second step ran, so the
-- weaponisation the run itself just discovered is overwritten by the same run's
-- bookkeeping. `advance_clone_lifecycle` is a blind UPDATE with no current-state
-- read and no edge guard — deliberately unlike apply_clone_urlscan_verdict,
-- which takes `SELECT ... FOR UPDATE` and never downgrades a terminal state.
--
-- This was latent before #990: the reputation branch never advanced the
-- lifecycle, so a no-op state write had nothing to clobber. #990 gave it
-- something. The prior audit flagged the shape as a risk and it was recorded in
-- #991's risk table; this is that risk arriving.
--
-- The consequence is quiet and metric-shaped rather than loud: `weaponised_at`
-- survives, so the weaponised.v1 emit gate still fires and the brand alert is
-- still sent — but every count, digest and report card reads `lifecycle_state`,
-- so the row lands in the `declined` bucket. It corrupts precisely the
-- weaponised-after-decline number #990 existed to correct.
--
-- Fix: a dedicated RPC that touches recheck bookkeeping and NOTHING else, so the
-- recheck lane never has to name a lifecycle state it read minutes earlier.
--
-- Deliberately a separate function rather than a p_mark_rechecked_only flag on
-- advance_clone_lifecycle: "advance the lifecycle" and "record that we looked"
-- are different writes, and a flag would leave the dangerous p_to_state
-- parameter sitting there for the next caller to pass a stale value into. Same
-- reasoning as v274's transient-miss RPC. advance_clone_lifecycle keeps its
-- existing signature and callers; this simply removes its only no-op caller.

CREATE OR REPLACE FUNCTION public.mark_clone_alert_rechecked(
  p_alert_id bigint
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  UPDATE public.shopfront_clone_alerts
  SET recheck_count = recheck_count + 1,
      last_rechecked_at = now(),
      updated_at = now()
  WHERE id = p_alert_id;
$function$;

REVOKE ALL ON FUNCTION public.mark_clone_alert_rechecked(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_clone_alert_rechecked(bigint)
  TO service_role;

COMMENT ON FUNCTION public.mark_clone_alert_rechecked(bigint) IS
  'Record that the recheck loop looked at this alert: bumps recheck_count and '
  'last_rechecked_at, and touches NOTHING else. Exists because the loop used to '
  'do this through advance_clone_lifecycle with a lifecycle_state read before '
  'its own submit step ran, so a weaponisation discovered mid-run was overwritten '
  'by the same run''s bookkeeping 30s later (v278, alert 2272).';

-- Repair the rows already clobbered. A row carrying weaponised_at but sitting in
-- a NON-terminal state is the signature; taken_down / reported are legitimate
-- onward states and must not be dragged backwards.
UPDATE public.shopfront_clone_alerts
SET lifecycle_state = 'weaponised',
    updated_at = now()
WHERE weaponised_at IS NOT NULL
  AND lifecycle_state NOT IN ('weaponised', 'taken_down', 'reported');
