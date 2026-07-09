-- migration-v217-clone-netcraft-reconcile.sql
--
-- Clone-Watch — Netcraft PER-URL lifecycle reconciler (PR3.1, Part A).
--
-- Problem (mapped in docs/plans/clone-watch-brand-story-reporting.md §2a):
-- the ~892 AUTO-submitted clones never get their lifecycle advanced — the
-- rollup poll is dark and clone-watch-netcraft-auto never calls
-- advance_clone_lifecycle. So lifecycle_state is stale and the
-- median-time-to-takedown KPI (which reads submitted_to.netcraft.takedown_at,
-- written only by the dark poll) is starved.
--
-- Fix: a keyless reconciler reads the PER-URL truth from
-- GET /submission/{uuid}/urls (the same source as the false-negative reporter,
-- NOT the buggy rollup) and advances each alert's lifecycle by its OWN url_state:
--   malicious            -> taken_down  (+ stamp submitted_to.netcraft.takedown_at → KPI)
--   no threats / unavailable -> declined (→ feeds the 6h weaponisation recheck loop)
--   suspicious / processing / no-match -> unchanged (just stamp reconciled_at)
-- It NEVER downgrades weaponised/taken_down/dormant (those are excluded from the
-- worklist), matching apply_clone_urlscan_verdict's no-downgrade invariant.
--
-- Two RPCs, both SECURITY DEFINER + search_path='' fully-qualified, EXECUTE
-- revoked from PUBLIC/anon/authenticated (service-role reconciler only).

-- ── 1. Reconcile worklist (per submission uuid, cadence-throttled) ───────────
CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_netcraft_reconcile(
  p_max_age_days integer DEFAULT 30,
  p_uuid_limit integer DEFAULT 60,
  p_cadence_hours integer DEFAULT 24
)
RETURNS TABLE(
  netcraft_uuid text,
  alerts jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH pending AS (
    SELECT
      sca.submitted_to -> 'netcraft' ->> 'uuid' AS uuid,
      (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz AS submitted_at,
      pg_catalog.jsonb_build_object(
        'id', sca.id,
        'candidate_domain', sca.candidate_domain,
        'candidate_url', sca.candidate_url,
        'lifecycle_state', sca.lifecycle_state
      ) AS alert
    FROM public.shopfront_clone_alerts sca
    WHERE sca.submitted_to ? 'netcraft'
      AND sca.submitted_to -> 'netcraft' ->> 'uuid' IS NOT NULL
      -- Only non-terminal, non-weaponised states get reconciled by the Netcraft
      -- verdict — never downgrade a domain we already know is phishing/down/dead.
      AND sca.lifecycle_state IN ('detected', 'monitoring', 'reported', 'declined')
      AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= pg_catalog.now() - (p_max_age_days || ' days')::interval
      -- cadence throttle: skip anything reconciled within the window
      AND (
        (sca.submitted_to -> 'netcraft' ->> 'reconciled_at') IS NULL
        OR (sca.submitted_to -> 'netcraft' ->> 'reconciled_at')::timestamptz
             <= pg_catalog.now() - (p_cadence_hours || ' hours')::interval
      )
  )
  SELECT
    p.uuid,
    pg_catalog.jsonb_agg(p.alert ORDER BY (p.alert ->> 'id')::bigint)
  FROM pending p
  GROUP BY p.uuid
  ORDER BY min(p.submitted_at) ASC
  LIMIT GREATEST(1, p_uuid_limit);
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_netcraft_reconcile(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- ── 2. Bulk reconcile apply (lifecycle + takedown_at + reconciled_at) ────────
-- p_to_state NULL  = only stamp reconciled_at (cadence bookkeeping; no change).
-- p_stamp_takedown = also set submitted_to.netcraft.takedown_at (first-touch;
--                    idempotent — never resets an existing takedown time).
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
      -- netcraft_declined_at is last-touch (matches advance_clone_lifecycle).
      netcraft_declined_at = CASE WHEN p_to_state = 'declined'
                                  THEN pg_catalog.now() ELSE sca.netcraft_declined_at END,
      alert_state = CASE WHEN p_to_state = 'taken_down' THEN 'taken_down'
                         ELSE sca.alert_state END,
      submitted_to = pg_catalog.jsonb_set(
        CASE
          WHEN p_stamp_takedown
               AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
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
