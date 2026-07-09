-- migration-v219-reconcile-witnessed-takedown.sql
--
-- Clone-Watch — TTD honesty fix (tech-debt TD1). Replaces apply_netcraft_reconcile
-- (v217) so the median-time-to-takedown KPI can't be inflated by the backfill.
--
-- Problem: v217 stamped submitted_to.netcraft.takedown_at = now() the FIRST time
-- the reconciler observed a URL as `malicious`. For the ~892 pre-existing clones
-- Netcraft had ALREADY actioned before the reconciler ever ran, that stamps the
-- takedown time as "first observation" (weeks after the real action), so
-- clone_watch_takedown_stats (which reads takedown_at − submitted_at) would read
-- the median far too high until the backlog churns out.
--
-- Fix (no magic threshold): only stamp takedown_at when we WITNESSED the
-- transition — i.e. the alert already carries a `reconciled_at` (we observed it
-- on a prior run, so a fresh flip to malicious is a real, timed transition). The
-- FIRST observation of an already-malicious clone (no prior reconciled_at) is
-- backfill: it still advances lifecycle to taken_down (the COUNT stays accurate)
-- but gets NO takedown_at, so it is correctly excluded from the timing metric —
-- we never watched it, so its takedown time is genuinely unknowable.
--
-- Going forward every clone is observed daily from submission, so a real
-- decline→malicious (or reported→malicious) flip is caught within one cadence
-- and stamped accurately. Same signature as v217 (CREATE OR REPLACE) — no fn
-- code change needed. SECURITY DEFINER, search_path='' fully-qualified.

CREATE OR REPLACE FUNCTION public.apply_netcraft_reconcile(
  p_alert_ids bigint[],
  p_to_state text DEFAULT NULL,
  p_stamp_takedown boolean DEFAULT false
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET
      lifecycle_state = COALESCE(p_to_state, sca.lifecycle_state),
      netcraft_declined_at = CASE WHEN p_to_state = 'declined'
                                  THEN pg_catalog.now() ELSE sca.netcraft_declined_at END,
      alert_state = CASE WHEN p_to_state = 'taken_down' THEN 'taken_down'
                         ELSE sca.alert_state END,
      submitted_to = pg_catalog.jsonb_set(
        CASE
          -- Stamp takedown_at only for a WITNESSED transition: first-touch AND we
          -- have observed this alert before (reconciled_at present). A first-ever
          -- observation of an already-malicious clone (backfill) is left unstamped
          -- so it counts as taken_down but never skews the time-to-takedown KPI.
          WHEN p_stamp_takedown
               AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
               AND (sca.submitted_to -> 'netcraft' ->> 'reconciled_at') IS NOT NULL
          THEN pg_catalog.jsonb_set(
                 sca.submitted_to, '{netcraft,takedown_at}',
                 pg_catalog.to_jsonb(pg_catalog.now()::text), true)
          ELSE sca.submitted_to
        END,
        '{netcraft,reconciled_at}',
        pg_catalog.to_jsonb(pg_catalog.now()::text), true
      ),
      updated_at = pg_catalog.now()
    WHERE sca.id = ANY(p_alert_ids)
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE EXECUTE ON FUNCTION public.apply_netcraft_reconcile(bigint[], text, boolean)
  FROM PUBLIC, anon, authenticated;
