-- migration-v326-recheck-dead-dormancy-and-age-taper.sql
--
-- Map #1224, ticket #1232 (stop wasting lookups). Two changes to the recheck
-- worklist, measured in prod on 2026-09-26 (clone_watch_scan_transitions since
-- 2026-07-16, 14,562 rechecks):
--
-- 1. Dead-domain dormancy. 228 declined rows had never obtained a urlscan
--    uuid, carried a failure streak of 6–36 and a 400 status (urlscan "DNS
--    Error" or our DNS precheck) and had absorbed 1,328 rechecks — weekly,
--    forever, because this worklist never reads urlscan_failure_streak. A row
--    with no uuid, a streak >= 8 (≈ eight weekly attempts at the 168 h dead
--    cadence) and a 400 status is excluded. The threshold keeps the early
--    window where the three observed 400 → likely_phishing flips happened (at
--    3, 9 and 80 days; all three had streaks well under 8 when they flipped).
--    Both predicates use COALESCE(status, '') so a NULL evidence status can
--    never make the worklist and the count disagree.
--    Dormancy is reversible: the month-end liveness job (#1225) clears
--    urlscan_failure_streak for dormant-dead rows whose DNS now resolves, which
--    returns them to the pool on the next run.
--    Nothing is deleted or re-stated: the rows keep their state, and
--    count_clone_recheck_dormant_dead() reports how many are held out so the
--    lane's Outcome Row makes the exclusion visible (worklist-gate-starvation
--    rule: an exclusion must be counted, not silent).
--
-- 2. Age taper. 38 of the 48 neutral → likely_phishing flips (79%) happened
--    within 45 days of first sight; 10 after. Rows older than 45 days move
--    from the 6 h cadence to 24 h (the 90-day stop was already live). The 168 h
--    dead cadence and the v317 recheck_count >= 8 weekly backoff keep
--    precedence.
--
-- Body otherwise identical to v317 (pg_get_functiondef 2026-09-23); signature
-- unchanged; function-level statement_timeout kept (supabase/CLAUDE.md §4).

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

-- How many pool rows the dormancy predicate holds out (Outcome Row field
-- `dormant_dead`). Mirrors the worklist's pool + exclusion predicates exactly.
CREATE OR REPLACE FUNCTION public.count_clone_recheck_dormant_dead()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  SELECT count(*)::integer
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    AND sca.urlscan_uuid IS NULL
    AND sca.urlscan_failure_streak >= 8
    AND COALESCE(sca.urlscan_evidence ->> 'status', '') = '400';
$function$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.count_clone_recheck_dormant_dead() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_clone_recheck_dormant_dead() TO service_role;

COMMIT;
