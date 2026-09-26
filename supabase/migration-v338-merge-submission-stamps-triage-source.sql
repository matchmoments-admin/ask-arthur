-- migration-v338-merge-submission-stamps-triage-source.sql — the Netcraft
-- auto lane's tp_actioned stops reading as a human true positive (#1263,
-- child of map #1224).
--
-- WHY. v335 (#1237) added shopfront_clone_alerts.triage_source and its header
-- claimed merge_clone_alert_submission need not stamp it, because "Netcraft's
-- tp_confirmed → tp_actioned keeps the human origin and triage_at". That is
-- only true of ONE edge. The auto lane's worklist
-- (list_clone_alerts_pending_netcraft_auto) accepts every status except fp,
-- and recordAutoSubmission (apps/web/lib/clone-watch/netcraft-report.ts)
-- passes p_set_triage_status = 'tp_actioned' unconditionally. So a human
-- `needs_investigation` (triage_source = 'human', triage_at stamped) that the
-- lane later submits becomes tp_actioned + human + triage_at-in-month, and
-- clone_watch_readiness_inputs counts it as a human DECIDED true positive —
-- a deferral turned into a verdict nobody gave, inflating precision.
-- Latent on 2026-09-27: all 1,612 prod auto_bulk tp_actioned rows have
-- triage_at NULL and triage_source NULL, so no historical row is miscounted
-- and no backfill is needed.
--
-- The fix is at the write, not the read: there is no status history, so the
-- readiness query cannot tell afterwards whether a tp_actioned row was a
-- human tp_confirmed first. The UPDATE can — in a SET list every column
-- reference reads the OLD row — so the stamp is atomic with the transition.
--
-- Rule (triage_source = "who set the CURRENT triage_status"): when this
-- function CHANGES triage_status, the new status was set by a machine, so
-- triage_source = 'machine' — EXCEPT tp_confirmed → tp_actioned, which is
-- Netcraft executing a human's verdict and keeps the existing origin.
-- Unchanged status (p_set_triage_status NULL, or equal to the current one,
-- e.g. a resubmission of an already-tp_actioned alert) keeps triage_source.
-- triage_at is untouched, as before (a machine transition never stamps it).
--
-- merge_clone_alert_submission is re-created from its LIVE prod body
-- (pg_get_functiondef, 2026-09-27), preserving signature, return shape,
-- validation and the submitted_to merge. Changes beyond the stamp:
--   - search_path '' (was 'public, pg_catalog'): SECURITY DEFINER rule,
--     supabase/CLAUDE.md §4; the body already qualifies public.* and uses
--     only pg_catalog builtins (always searched).
--   - #variable_conflict use_column (RETURNS TABLE rule, §4).
--   - function-level SET statement_timeout = '15s' (§4; the live one had
--     none, so .rpc() ran under authenticator's 8 s).
-- Signature unchanged, so CREATE OR REPLACE keeps the ACL; REVOKE/GRANT are
-- restated anyway (live ACL: postgres + service_role only; §7).
--
-- Other callers are unaffected: notify-brand, notify-weaponised, the admin
-- triage route and the urlscan submit path all pass p_set_triage_status NULL.
-- merge_clone_alert_submission_bulk never touches triage_status.
--
-- Idempotent (CREATE OR REPLACE, same signature). Rollback: re-apply the
-- live body quoted in the PR (#1263) — the pre-v338 function is this one
-- minus the triage_source assignment, the pragma, the statement_timeout, and
-- with search_path 'public', 'pg_catalog'.

BEGIN;

CREATE OR REPLACE FUNCTION public.merge_clone_alert_submission(
  p_alert_id bigint,
  p_key text,
  p_value jsonb,
  p_set_triage_status text DEFAULT NULL::text
)
RETURNS TABLE(id bigint, submitted_to jsonb, triage_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '15s'
AS $function$
#variable_conflict use_column
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR length(p_key) > 64 THEN
    RAISE EXCEPTION 'invalid merge key: %', p_key USING ERRCODE = '22023';
  END IF;
  IF p_set_triage_status IS NOT NULL
     AND p_set_triage_status NOT IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned') THEN
    RAISE EXCEPTION 'invalid triage status: %', p_set_triage_status USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.shopfront_clone_alerts AS sca
  SET submitted_to = jsonb_set(
        COALESCE(sca.submitted_to, '{}'::jsonb),
        ARRAY[p_key],
        p_value,
        true
      ),
      triage_status = COALESCE(p_set_triage_status, sca.triage_status),
      -- #1263: a status this function CHANGES was set by a machine, except
      -- tp_confirmed → tp_actioned (Netcraft executing a human verdict).
      -- sca.* here is the OLD row.
      triage_source = CASE
        WHEN p_set_triage_status IS NOT NULL
         AND p_set_triage_status IS DISTINCT FROM sca.triage_status
         -- IS NOT DISTINCT FROM, not `=`: a NULL prior status would make
         -- NOT (NULL AND …) NULL and fall through to ELSE unstamped.
         AND NOT (sca.triage_status IS NOT DISTINCT FROM 'tp_confirmed'
                  AND p_set_triage_status = 'tp_actioned')
        THEN 'machine'
        ELSE sca.triage_source
      END
  WHERE sca.id = p_alert_id
  RETURNING sca.id, sca.submitted_to, sca.triage_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text)
  TO service_role;

COMMENT ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text) IS
  'Merge one submission ledger key into shopfront_clone_alerts.submitted_to, optionally setting triage_status. v338 (#1263): a status change made here stamps triage_source = ''machine'' unless it is tp_confirmed -> tp_actioned (Netcraft executing a human verdict keeps its origin), so an auto-lane tp_actioned over a human needs_investigation is not a human true positive in clone_watch_readiness_inputs.';

COMMIT;
