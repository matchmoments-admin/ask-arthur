-- v328 — recheck worklist reports its true due count (#1231)
--
-- WHY. The lifecycle-recheck lane took 50 of ~1,420 due rows per run (50/50
-- every run since 2026-09-17) and nothing recorded how far behind it was: the
-- worklist is LIMITed, so the caller only ever saw `pool` = its own fetch
-- size. A cap that binds silently is the #1231 defect class.
--
-- WHAT. list_clone_alerts_for_recheck gains one output column, due_total =
-- count(*) OVER () across the filtered set before the LIMIT (a window count
-- over rows the query already reads; no second scan, no twin predicate to
-- drift). The lane writes it to its Outcome Row. Body otherwise identical to
-- v326 (same predicates, cadence CASE, ordering, clamp, statement_timeout).
--
-- The return type changes, so the function is dropped and re-created (CREATE
-- OR REPLACE cannot change OUT columns). Grants restated per v324. Old code
-- reading this RPC ignores the extra column; new code before this migration
-- reads due_total as absent → null. Idempotent (DROP IF EXISTS + CREATE).
--
-- Rollback: re-apply v326's list_clone_alerts_for_recheck (DROP first).

BEGIN;

DROP FUNCTION IF EXISTS public.list_clone_alerts_for_recheck(integer, integer, integer);

CREATE FUNCTION public.list_clone_alerts_for_recheck(p_limit integer DEFAULT 50, p_cadence_hours integer DEFAULT 6, p_dead_cadence_hours integer DEFAULT 168)
 RETURNS TABLE(id bigint, candidate_domain text, candidate_url text, lifecycle_state text, urlscan_classification text, recheck_count integer, last_rechecked_at timestamp with time zone, signals jsonb, attribution jsonb, clf_is_clone boolean, clf_confidence real, clf_attack_intent text, clf_clone_tactic text, brand_category text, due_total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  SELECT
    sca.id, sca.candidate_domain, sca.candidate_url, sca.lifecycle_state,
    sca.urlscan_classification, sca.recheck_count, sca.last_rechecked_at,
    sca.signals, sca.attribution, cwc.is_clone, cwc.confidence,
    cwc.attack_intent, cwc.clone_tactic, kb.brand_category,
    -- v328: rows due in total, computed over the filtered set BEFORE the
    -- LIMIT — the backlog the batch cap leaves, on every returned row.
    pg_catalog.count(*) OVER () AS due_total
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN LATERAL (
    SELECT kb2.brand_category FROM public.known_brands kb2
    WHERE kb2.brand_domain = sca.inferred_target_domain LIMIT 1
  ) kb ON true
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    -- v326: dead-domain dormancy (see header). Same predicate as
    -- count_clone_recheck_dormant_dead below — change both together.
    AND NOT (
      sca.urlscan_uuid IS NULL
      AND sca.urlscan_failure_streak >= 8
      AND COALESCE(sca.urlscan_evidence ->> 'status', '') = '400'
    )
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
               -- v326: older than 45 days → daily (79% of flips happen earlier).
               WHEN sca.first_seen_at < pg_catalog.now() - pg_catalog.make_interval(days => 45)
                 THEN GREATEST(p_cadence_hours, 24)
               ELSE GREATEST(1, p_cadence_hours)
             END
           )
    )
  ORDER BY sca.last_rechecked_at ASC NULLS FIRST, sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

COMMENT ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) IS
  'Recheck worklist (clone-watch-lifecycle-recheck): monitoring/declined NRD alerts < 90 days, dead-dormant held out (v326), due by the cadence CASE, stalest first, LIMIT clamped to 500. due_total = rows due before the LIMIT (v328).';

REVOKE ALL ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) TO service_role;

COMMIT;
