-- migration-v317-recheck-stale-backoff.sql
--
-- PR 4 of docs/plans/clone-watch-deepening-2026-09-23.md.
--
-- The recheck lane rescans declined/monitoring clones hoping to catch the
-- `declined → weaponised` flip. Prod, 14 days to 2026-09-22: ~2,850 rescans
-- produced 10 classification flips (0.35%, 4 from declined); 1,783 rows were
-- due against ~200/day of capacity, so the documented 6 h cadence was really
-- ~9 days; 614 declined rows had been rechecked 9–10 times already.
--
-- A row that has been rechecked 8+ times and is still in the pool (a flip
-- would have moved it to weaponised, out of the pool) backs off to weekly.
-- That frees capacity for fresh rows, where flips actually happen, without
-- dropping anything: the weekly cadence is still faster than the ~9 days the
-- backlog imposed. Body otherwise identical to the live definition
-- (pg_get_functiondef 2026-09-23); signature unchanged; function-level
-- statement_timeout added (supabase/CLAUDE.md §4).
--
-- The other half of this PR is in TS: urlscan submits (batch + recheck) now
-- DNS-precheck and skip a proved-gone name, stamping the same 400 the v277
-- dead-domain cadence already keys on.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_recheck(p_limit integer DEFAULT 50, p_cadence_hours integer DEFAULT 6, p_dead_cadence_hours integer DEFAULT 168)
 RETURNS TABLE(id bigint, candidate_domain text, candidate_url text, lifecycle_state text, urlscan_classification text, recheck_count integer, last_rechecked_at timestamp with time zone, signals jsonb, attribution jsonb, clf_is_clone boolean, clf_confidence real, clf_attack_intent text, clf_clone_tactic text, brand_category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  SELECT
    sca.id, sca.candidate_domain, sca.candidate_url, sca.lifecycle_state,
    sca.urlscan_classification, sca.recheck_count, sca.last_rechecked_at,
    sca.signals, sca.attribution, cwc.is_clone, cwc.confidence,
    cwc.attack_intent, cwc.clone_tactic, kb.brand_category
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN LATERAL (
    SELECT kb2.brand_category FROM public.known_brands kb2
    WHERE kb2.brand_domain = sca.inferred_target_domain LIMIT 1
  ) kb ON true
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    AND (
      sca.last_rechecked_at IS NULL
      OR sca.last_rechecked_at
         < pg_catalog.now() - pg_catalog.make_interval(
             hours => CASE
               WHEN sca.urlscan_evidence ->> 'status' = '400'
                 THEN GREATEST(1, p_dead_cadence_hours)
               -- v317: a row rechecked 8+ times without leaving the pool has
               -- shown nothing to watch for; weekly, not every 6 h.
               WHEN sca.recheck_count >= 8
                 THEN GREATEST(p_cadence_hours, 168)
               ELSE GREATEST(1, p_cadence_hours)
             END
           )
    )
  ORDER BY sca.last_rechecked_at ASC NULLS FIRST, sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

COMMIT;
