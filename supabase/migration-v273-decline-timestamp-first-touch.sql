-- v273 — netcraft_declined_at must record the FIRST decline, not the last recheck.
--
-- Measured in prod 2026-08-09 21:31 UTC.
--
-- `advance_clone_lifecycle` stamped the decline clock unconditionally:
--
--     weaponised_at        = CASE WHEN p_to_state = 'weaponised'
--                                 THEN COALESCE(weaponised_at, now()) ELSE weaponised_at END,
--     netcraft_declined_at = CASE WHEN p_to_state = 'declined'
--                                 THEN now() ELSE netcraft_declined_at END,
--                                      -- ^ no COALESCE, one line below a guarded twin
--
-- The lifecycle-recheck cron calls this with `p_to_state => c.lifecycle_state`
-- — its own current state, a deliberate no-op state change whose purpose is the
-- `p_mark_rechecked` bump. For a row already in 'declined' that is not a no-op:
-- it moves the decline clock forward to now(), every 6 hours, forever.
--
-- Consequences measured before this migration:
--   * 859 of 1,561 declined rows have netcraft_declined_at = last_rechecked_at
--     EXACTLY — the signature of a restamp, not a coincidence.
--   * 1,497 of 1,561 (95.9%) appear to have been declined within the last 7 days.
--     The oldest surviving decline stamp is 2026-07-10, while rows in that set
--     were first seen from 2026-06-07. Every decline older than the recheck
--     window has been overwritten.
--   * The decline -> weaponise vendor-gap KPI — a PUBLISHED figure, reported as a
--     33-hour median in the monthly Clone-Watch data drop — now computes a
--     2.5-hour median with a 2.0-hour minimum over n=33. That is not a vendor
--     gap any more; it is a measurement of the recheck cadence. The restamp
--     always moves the decline stamp closer to the weaponisation, so the bias is
--     one-directional: it compresses every duration toward zero.
--
-- Fix: COALESCE-guard the stamp so the FIRST transition into 'declined' wins,
-- matching the `weaponised_at` line directly above it. A row that genuinely
-- re-enters 'declined' after a taken_down/weaponised excursion keeps its
-- original stamp, which is the correct reading of "when did the vendor first
-- decline this" — the re-file is tracked separately by the transition archive.
--
-- THE PRE-FIX SERIES IS NOT RECOVERABLE. The originals were overwritten in place,
-- not archived. Durations computed from netcraft_declined_at before this
-- migration are compressed by an unknown, unrecoverable amount. Treat
-- 2026-08-09 as a hard discontinuity in that series and disclose it rather than
-- smoothing it; do not publish a new median in the same cycle as the fix.
--
-- Idempotent: CREATE OR REPLACE of one function, no data migration. Reverting
-- means dropping the COALESCE (and resuming the data loss).

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

REVOKE ALL ON FUNCTION public.advance_clone_lifecycle(bigint, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.advance_clone_lifecycle(bigint, text, jsonb, boolean) IS
  'Advance a clone alert''s lifecycle_state. netcraft_declined_at and weaponised_at '
  'are both COALESCE-guarded (v273): the FIRST transition into that state sets the '
  'clock. Before v273 the decline stamp was unguarded, and the recheck cron''s '
  'no-op state write walked it forward every 6h — destroying the decline->weaponise '
  'duration series irrecoverably for all data before 2026-08-09.';
