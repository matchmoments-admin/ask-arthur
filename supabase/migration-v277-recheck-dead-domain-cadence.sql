-- v277 — stop re-submitting non-resolving domains to urlscan every 6 hours.
--
-- `list_clone_alerts_for_recheck` applies ONE cadence to its whole pool, and has
-- neither a failure-streak nor a classification predicate (both sibling worklists
-- carry `urlscan_failure_streak < p_max_failure_streak`). The lifecycle-recheck
-- cron submits every selected row to urlscan inline, 50 per run x 4 runs/day.
--
-- Measured 2026-08-09: of the 1,562-row pool, 299 carry an
-- `urlscan_evidence->>'status' = '400'` stamp and 229 sit at failure_streak >= 3
-- with a maximum observed streak of 10 — 3.3x a cap of 3, a value only reachable
-- by continuous re-submission of rows nothing else will ever accept. urlscan
-- returns 400 when a domain has no DNS; every one of the 10 most recent
-- 400-stamped domains resolved to NXDOMAIN on probe, and the 44 rows that still
-- retain a response body all say "DNS Error - Could not resolve domain".
--
-- So ~1,200 urlscan submits a week are spent asking about domains that do not
-- exist, on a lane whose per-run capacity is the constraint on catching the ones
-- that do.
--
-- WHY A CADENCE AND NOT AN EXCLUSION. The obvious fix — filter out
-- `status = '400'`, or gate on the failure streak — is wrong twice over:
--
--   * A 400 is not permanent. 8 of the 326 rows that once 400'd later acquired a
--     uuid and classified; the domain was stood up between attempts. An
--     exclusion would have lost those.
--   * This lane is currently the ONLY one that rescues streak >= 3 rows — the
--     submit and retrieve worklists both exclude them, and a successful submit
--     here resets the streak to 0. Adding a streak filter would make 229 rows
--     genuinely terminal, converting a slow-draining backlog into permanent loss.
--
-- A second, much longer cadence keeps the recovery path open at ~1/28th the cost:
-- 299 rows move from 4 probes/day to 1/week. Self-correcting, because
-- persist_clone_alert_urlscan overwrites urlscan_evidence wholesale — the moment
-- a domain resolves and scans, the '400' stamp disappears and the row returns to
-- the normal 6h cadence on its own.
--
-- Signature change: adds p_dead_cadence_hours. DROP first — adding a parameter to
-- an existing function creates an overload rather than replacing it, and existing
-- two-argument callers would then fail to resolve. The default keeps the current
-- call site (clone-watch-lifecycle-recheck.ts, two args) working unchanged.

DROP FUNCTION IF EXISTS public.list_clone_alerts_for_recheck(integer, integer);

CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_recheck(
  p_limit integer DEFAULT 50,
  p_cadence_hours integer DEFAULT 6,
  p_dead_cadence_hours integer DEFAULT 168
)
RETURNS TABLE(
  id bigint,
  candidate_domain text,
  candidate_url text,
  lifecycle_state text,
  urlscan_classification text,
  recheck_count integer,
  last_rechecked_at timestamp with time zone,
  signals jsonb,
  attribution jsonb,
  clf_is_clone boolean,
  clf_confidence real,
  clf_attack_intent text,
  clf_clone_tactic text,
  brand_category text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
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
             -- v277: a domain urlscan refused with a 400 (no DNS) gets a much
             -- longer cadence, not an exclusion — it can still be stood up later,
             -- and this lane is the only one that can rescue a streak-frozen row.
             hours => CASE
               WHEN sca.urlscan_evidence ->> 'status' = '400'
                 THEN GREATEST(1, p_dead_cadence_hours)
               ELSE GREATEST(1, p_cadence_hours)
             END
           )
    )
  ORDER BY sca.last_rechecked_at ASC NULLS FIRST, sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_clone_alerts_for_recheck(integer, integer, integer) IS
  'Clone alerts due for a lifecycle re-check. Rows whose last urlscan submit was '
  'refused with HTTP 400 (urlscan''s no-DNS response) use p_dead_cadence_hours '
  '(default 168) instead of p_cadence_hours (v277): they were consuming ~1,200 '
  'urlscan submits a week asking about domains that do not exist. Deliberately a '
  'cadence and NOT an exclusion — a 400 is not permanent (8 such rows later '
  'scanned successfully), and this is the only lane that can reset a '
  'failure-streak-frozen row. Self-correcting: a successful scan overwrites '
  'urlscan_evidence, dropping the 400 stamp.';
