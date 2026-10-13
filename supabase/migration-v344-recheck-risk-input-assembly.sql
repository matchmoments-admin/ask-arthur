-- v344 — the recheck worklist returns the category lookup KEY, and its own
-- category column becomes deterministic (#1298)
--
-- WHY. The weaponisation-risk score has two callers: the recheck lane's
-- ranking (clone-watch-lifecycle-recheck.ts) and the Brand Stewardship
-- "highest-risk lookalikes" (report-brand-stewardship.ts). They resolved the
-- impersonated brand's category differently:
--   * this RPC: LEFT JOIN LATERAL (… known_brands WHERE brand_domain = …
--     LIMIT 1) with no ORDER BY and no NULL filter;
--   * stewardship: a Map of the first NON-NULL category, in arbitrary order.
-- Measured 2026-10-13: known_brands has 307 rows over 294 brand domains; 11
-- domains (commbank, ato, binance, ebay, kmart, target, 7eleven, dominos,
-- mcdonalds, facebook, netflix) carry one categorised row and one NULL-category
-- twin, servicesaustralia has three NULL rows, and no domain has two different
-- categories. 55 of the 467 rows in the recheck pool target one of those
-- domains — so whether a commbank lookalike earns its 12 "bank" points in the
-- recheck ranking depended on heap order. (Today every one of the 55 happens
-- to resolve to the categorised row; nothing guarantees it.)
--
-- REQUIRES v343 (#1307) APPLIED FIRST; MERGE #1307 BEFORE #1305.
-- v343 (migration-v343-clone-dns-precheck-column.sql) also redefines this
-- function: it swaps the `urlscan_evidence->>'status' = '400'` dead test for
-- the NULL-safe public.clone_alert_dns_dead(dns_precheck, urlscan_evidence)
-- predicate. This file is built from v343's body so applying it after v343
-- keeps that predicate exactly; applying it BEFORE v343 fails at CREATE (the
-- guard below raises, and the body references v343's function and column).
--
-- WHAT. list_clone_alerts_for_recheck — re-created from v343's body (itself
-- the live v334 body with the dead predicate swapped), every branch kept.
-- Two changes:
--   1. One more OUT column, inferred_target_domain. The lane now resolves the
--      category in TypeScript through the SAME lookup stewardship uses
--      (apps/web/lib/clone-watch/alert-risk.ts brandCategoryLookup), so both
--      score an alert identically by construction. The ONE rule lives there.
--   2. brand_category's lateral becomes deterministic and mirrors that rule
--      (non-null category of the lowest known_brands.id). It is kept ONLY for
--      code still deployed before this migration's PR (which reads it); the
--      new code ignores it whenever inferred_target_domain is present.
-- OUT columns changed, so DROP + CREATE in one transaction. Old code passes
-- the same arguments and ignores the extra column.
--
-- Idempotent: DROP IF EXISTS + CREATE inside BEGIN/COMMIT. Read-only function;
-- no data touched. Rollback: DROP this function, then re-run the
-- list_clone_alerts_for_recheck block of
-- migration-v343-clone-dns-precheck-column.sql (CREATE OR REPLACE).

BEGIN;

-- Ordering guard: v343 must already be applied.
DO $guard$
BEGIN
  IF pg_catalog.to_regprocedure('public.clone_alert_dns_dead(text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'v344 requires v343 (#1307): public.clone_alert_dns_dead(text, jsonb) is missing — apply v343 first';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.list_clone_alerts_for_recheck(integer, integer, integer);

CREATE FUNCTION public.list_clone_alerts_for_recheck(p_limit integer DEFAULT 50, p_cadence_hours integer DEFAULT 6, p_dead_cadence_hours integer DEFAULT 168)
 RETURNS TABLE(id bigint, candidate_domain text, candidate_url text, lifecycle_state text, urlscan_classification text, recheck_count integer, last_rechecked_at timestamp with time zone, signals jsonb, attribution jsonb, clf_is_clone boolean, clf_confidence real, clf_attack_intent text, clf_clone_tactic text, brand_category text, due_total bigint, first_seen_at timestamp with time zone, recheck_dns_fingerprint text, recheck_dns_checked_at timestamp with time zone, queue_clock_at timestamp with time zone, inferred_target_domain text)
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
    pg_catalog.count(*) OVER () AS due_total,
    -- v334: the DNS gate's inputs.
    sca.first_seen_at, sca.recheck_dns_fingerprint, sca.recheck_dns_checked_at,
    clk.at AS queue_clock_at,
    -- v344: the category lookup key (alert-risk.ts, #1298).
    sca.inferred_target_domain
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN LATERAL (
    -- v344: deterministic, mirroring alert-risk.ts brandCategoryLookup
    -- (non-null category of the lowest id). Deploy-window column only.
    SELECT kb2.brand_category FROM public.known_brands kb2
    WHERE kb2.brand_domain = sca.inferred_target_domain
      AND kb2.brand_category IS NOT NULL
    ORDER BY kb2.id
    LIMIT 1
  ) kb ON true
  -- v330: is this a not-a-clone audit sample still judged is_clone=false?
  LEFT JOIN LATERAL (
    SELECT (cwc.is_clone IS NOT TRUE AND EXISTS (
      SELECT 1 FROM public.clone_watch_not_a_clone_samples nac
      WHERE nac.alert_id = sca.id
    )) AS nac_audit
  ) aud ON true
  -- v334: the queue clock, defined ONCE.
  LEFT JOIN LATERAL (
    SELECT GREATEST(
      CASE WHEN aud.nac_audit THEN COALESCE(sca.last_rechecked_at, sca.urlscan_scanned_at)
           ELSE sca.last_rechecked_at END,
      sca.recheck_dns_checked_at
    ) AS at
  ) clk ON true
  -- v343: the ONE dead predicate (never NULL).
  CROSS JOIN LATERAL (
    SELECT public.clone_alert_dns_dead(sca.dns_precheck, sca.urlscan_evidence) AS dead
  ) dd
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND sca.first_seen_at > pg_catalog.now() - pg_catalog.make_interval(days => 90)
    -- v326: dead-domain dormancy. Same predicate as
    -- count_clone_recheck_dormant_dead — change both together.
    AND NOT (
      sca.urlscan_uuid IS NULL
      AND sca.urlscan_failure_streak >= 8
      AND dd.dead
    )
    AND (
      clk.at IS NULL
      OR clk.at
         < pg_catalog.now() - pg_catalog.make_interval(
             hours => CASE
               WHEN dd.dead
                 THEN GREATEST(1, p_dead_cadence_hours)
               -- v330: sampled not-a-clones are low-yield — weekly.
               WHEN aud.nac_audit
                 THEN GREATEST(p_cadence_hours, 168)
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
  ORDER BY clk.at ASC NULLS FIRST,
           sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$function$;

COMMENT ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) IS
  'Recheck worklist (clone-watch-lifecycle-recheck): monitoring/declined NRD alerts < 90 days, dead-dormant held out (v326), due by the cadence CASE, stalest first, LIMIT clamped to 1000 (v334). due_total = rows due before the LIMIT (v328). Sampled not-a-clones (v330) run weekly, clocked from their audit scan. v334: queue clock = GREATEST(that clock, recheck_dns_checked_at); returns the DNS gate inputs. v343: dead = clone_alert_dns_dead(dns_precheck, urlscan_evidence). v344: returns inferred_target_domain (the risk scorer resolves the category via alert-risk.ts); brand_category is deterministic (lowest-id non-null) and kept for the deploy window only.';

REVOKE ALL ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) TO service_role;

COMMIT;
