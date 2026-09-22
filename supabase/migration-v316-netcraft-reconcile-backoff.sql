-- migration-v316-netcraft-reconcile-backoff.sql
--
-- PR 3 of docs/plans/clone-watch-deepening-2026-09-23.md.
--
-- The reconciler is the largest step consumer in clone-watch (prod audit
-- 2026-09-22: ~54 steps/day, median run 6.9 min, max 13.6 of a 15 min finish
-- — a finish-cancel is silent) and nearly all of that work is re-reading
-- verdicts that do not change: 1,346 re-reads that returned the same
-- `no threats` against 6 takedowns in 14 days, because every submitted alert
-- is revisited every ~1.4 days forever (30-day window).
--
-- 1. record_netcraft_url_verdicts (v314) additionally maintains
--    submitted_to.netcraft.unchanged_reads: +1 when the verdict equals the
--    stored one, 0 when it changes. Body otherwise identical to v314.
-- 2. list_clone_alerts_for_netcraft_reconcile (v249) backs a row off to a
--    72 h cadence once unchanged_reads >= 3. A change resets the counter, so
--    a verdict that moves is followed at full cadence again. Signature
--    unchanged; body identical to v249 plus the CASE and a function-level
--    statement_timeout (supabase/CLAUDE.md §4).
--
-- The function-side batching (one fetch step, one apply step) is in
-- clone-watch-netcraft-reconcile.ts. Neither change drops a row: backoff only
-- stretches the revisit interval.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_netcraft_url_verdicts(p_verdicts jsonb)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  WITH v AS (
    SELECT
      (e ->> 'id')::bigint                         AS id,
      NULLIF(e ->> 'url_state', '')                AS url_state,
      NULLIF(e ->> 'reason', '')                   AS reason,
      NULLIF(e ->> 'malicious_at', '')::timestamptz AS malicious_at,
      NULLIF(e ->> 'netcraft_submitted_at', '')::timestamptz AS nc_submitted_at
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_verdicts, '[]'::jsonb)) e
    WHERE (e ->> 'id') IS NOT NULL
  ),
  calc AS (
    SELECT
      sca.id,
      v.url_state,
      v.reason,
      v.malicious_at,
      -- LEAST ignores NULLs: whichever clock we have, the earlier one wins.
      LEAST(
        (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz,
        v.nc_submitted_at
      )                                                                     AS submitted_at,
      (sca.submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz AS issue_at,
      sca.submitted_to
    FROM public.shopfront_clone_alerts sca
    JOIN v ON v.id = sca.id
    WHERE sca.submitted_to ? 'netcraft'
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET submitted_to = (
      SELECT pg_catalog.jsonb_set(
        c.submitted_to,
        '{netcraft}',
        ((c.submitted_to -> 'netcraft') - 'already_malicious_at_submit')
          || pg_catalog.jsonb_build_object(
               'url_state',        c.url_state,
               'url_state_reason', c.reason,
               'url_state_at',     pg_catalog.now()::text,
               -- v316 backoff input: consecutive reads with the same verdict.
               'unchanged_reads',  CASE
                 WHEN (c.submitted_to -> 'netcraft' ->> 'url_state') IS NOT DISTINCT FROM c.url_state
                 THEN COALESCE((c.submitted_to -> 'netcraft' ->> 'unchanged_reads')::int, 0) + 1
                 ELSE 0
               END
             )
          -- Vendor-dated takedown: first stamp only, never before our submission.
          || CASE
               WHEN c.malicious_at IS NOT NULL
                    AND c.submitted_at IS NOT NULL
                    AND c.malicious_at >= c.submitted_at
                    AND (c.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
               THEN pg_catalog.jsonb_build_object(
                      'takedown_at',        c.malicious_at::text,
                      'takedown_at_source', 'netcraft_log'
                    )
                    || CASE
                         WHEN c.issue_at IS NOT NULL AND c.malicious_at >= c.issue_at
                         THEN pg_catalog.jsonb_build_object('re_takedown_at', c.malicious_at::text)
                         ELSE '{}'::jsonb
                       END
               ELSE '{}'::jsonb
             END
          -- Already on Netcraft's list before we reported it: not our credit,
          -- and a negative duration must never reach the TTD KPI.
          || CASE
               WHEN c.malicious_at IS NOT NULL
                    AND c.submitted_at IS NOT NULL
                    AND c.malicious_at < c.submitted_at
               THEN pg_catalog.jsonb_build_object('already_malicious_at_submit', true)
               ELSE '{}'::jsonb
             END,
        true
      )
      FROM calc c WHERE c.id = sca.id
    ),
    updated_at = pg_catalog.now()
    WHERE sca.id IN (SELECT id FROM calc)
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_netcraft_reconcile(
  p_max_age_days integer DEFAULT 30,
  p_uuid_limit integer DEFAULT 60,
  p_cadence_hours integer DEFAULT 24
)
RETURNS TABLE(netcraft_uuid text, alerts jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
SET statement_timeout = '30s'
AS $function$
  WITH pending AS (
    SELECT
      sca.submitted_to -> 'netcraft' ->> 'uuid' AS uuid,
      (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz AS submitted_at,
      (sca.submitted_to -> 'netcraft' ->> 'reconciled_at')::timestamptz AS reconciled_at,
      pg_catalog.jsonb_build_object(
        'id', sca.id,
        'candidate_domain', sca.candidate_domain,
        'candidate_url', sca.candidate_url,
        'lifecycle_state', sca.lifecycle_state
      ) AS alert
    FROM public.shopfront_clone_alerts sca
    WHERE sca.submitted_to ? 'netcraft'
      AND sca.submitted_to -> 'netcraft' ->> 'uuid' IS NOT NULL
      -- v249: 'weaponised' joins the set. It is the ONLY way the
      -- escalation → takedown outcome can ever be witnessed. Downgrades are
      -- refused by apply_netcraft_reconcile below, so admitting it here is
      -- safe: a `no threats` on a weaponised row stamps reconciled_at only.
      AND sca.lifecycle_state IN
        ('detected', 'monitoring', 'reported', 'declined', 'weaponised')
      AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= pg_catalog.now() - (p_max_age_days || ' days')::interval
      AND (
        (sca.submitted_to -> 'netcraft' ->> 'reconciled_at') IS NULL
        OR (sca.submitted_to -> 'netcraft' ->> 'reconciled_at')::timestamptz
             <= pg_catalog.now() - (
                  -- v316 backoff: after 3 unchanged verdicts, every 72 h.
                  CASE WHEN COALESCE((sca.submitted_to -> 'netcraft' ->> 'unchanged_reads')::int, 0) >= 3
                       THEN GREATEST(p_cadence_hours, 72)
                       ELSE p_cadence_hours
                  END || ' hours')::interval
      )
  )
  SELECT
    p.uuid,
    pg_catalog.jsonb_agg(p.alert ORDER BY (p.alert ->> 'id')::bigint)
  FROM pending p
  GROUP BY p.uuid
  -- Round-robin: never-reconciled uuids first, then least-recently reconciled.
  ORDER BY min(p.reconciled_at) ASC NULLS FIRST, min(p.submitted_at) ASC
  LIMIT GREATEST(1, p_uuid_limit);
$function$;

COMMIT;
