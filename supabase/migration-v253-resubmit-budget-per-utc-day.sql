-- migration-v253-resubmit-budget-per-utc-day.sql
--
-- Clone-Watch — the resubmit lane fires every OTHER day.
--
-- Found on day 2 of the lane's life, verifying the v252 fix. Day 1 ran exactly
-- as designed (23 candidates → 9 deferred dead → 10 submitted, one Netcraft
-- uuid). Day 2 was about to submit nothing, for a reason nothing in the code
-- looks wrong about:
--
-- The 24h budget was a ROLLING window — `resubmitted_at > now() - 24 hours` —
-- anchored on when the previous run FINISHED, while the cron fires at a fixed
-- 09:30 UTC. Day 1's rows were stamped 09:30:52. Day 2's run starts 09:30:00.
-- That is 52 seconds INSIDE the window, so used = 10, budget_remaining = 0, the
-- worklist returns zero rows, and the run is a no-op. Day 3 sees 48h-old stamps
-- and works normally.
--
-- Measured on prod 2026-07-27 08:58 UTC, half an hour before the run:
--
--   used_24h            = 10   → budget 0   (today idles)
--   used_today_utc      =  0   → budget 10  (today fires)
--   used_at_next_cron   = 10   ← the run would have seen this
--
-- Net effect: 10 URLs every two days against a documented cap of "10/day" —
-- half the enforcement throughput, silently, with the lane returning ok:true on
-- the idle days and `reason: "none_pending_or_cap"` looking like an empty
-- worklist rather than a starved one.
--
-- Pre-existing since v250; v251 and v252 both carried the CTE unchanged. It was
-- unobservable until a second consecutive day existed — a run in isolation is
-- indistinguishable either way. Same family as the dead-row starvation v252
-- fixed: a bound that is correct per-run and wrong across runs.
--
-- The fix is one predicate: anchor the budget to the UTC day, which is what the
-- runbook has always claimed the cap is. A fixed-time cron can never clear a
-- rolling window its own previous run just wrote into. A manual re-fire later
-- the same day still counts the day's submissions and is still blocked, so the
-- anti-flood property the budget exists for is unchanged.
--
-- Everything else is v252 verbatim. No caller change — the RPC's signature and
-- return type are untouched, so this needs no deploy.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(
  p_limit integer DEFAULT 10,
  p_min_age_days integer DEFAULT 30,
  p_cooldown_days integer DEFAULT 14,
  p_max_resubmits integer DEFAULT 3,
  p_probe_limit integer DEFAULT NULL
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  urlscan_uuid text,
  weaponised_at timestamptz,
  budget_remaining integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH used AS (
    -- v253: per-UTC-day, not rolling-24h. See the header — a fixed-time cron
    -- can never clear a rolling window its own previous run just wrote into.
    SELECT count(*) AS n
    FROM public.shopfront_clone_alerts sca
    WHERE (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at')::timestamptz
            >= pg_catalog.date_trunc('day', pg_catalog.now())
  ),
  -- The probe window bounds the result via a window rank, not LIMIT: `LIMIT`
  -- may not reference a column from the query (42P10), only constants and
  -- params.
  elig AS (
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.urlscan_uuid,
    sca.weaponised_at,
    -- Freshest attacks first: a clone that weaponised today is still live and
    -- still taking victims; a 60-day-old one probably is not.
    row_number() OVER (
      ORDER BY sca.weaponised_at DESC NULLS LAST, sca.id ASC
    ) AS rn
  FROM public.shopfront_clone_alerts sca
  WHERE sca.lifecycle_state = 'weaponised'
    AND sca.candidate_url IS NOT NULL
    -- No usable submission: never submitted, malformed, or aged out of the
    -- reporter's window. v251 — a prior escalation no longer disqualifies a
    -- row; a fresh report is then the ONLY path left.
    AND (
      NOT (sca.submitted_to ? 'netcraft')
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at') IS NULL
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
           < pg_catalog.now() - pg_catalog.make_interval(days => p_min_age_days)
    )
    -- Already actioned → nothing to re-report.
    AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
    -- v252: proved dead at probe, bounded deferral + terminal exhaustion.
    AND (sca.submitted_to -> 'netcraft_resubmit' ->> 'skipped') IS NULL
    AND (
      (sca.submitted_to -> 'netcraft_resubmit' ->> 'recheck_after') IS NULL
      OR (sca.submitted_to -> 'netcraft_resubmit' ->> 'recheck_after')::timestamptz
           <= pg_catalog.now()
    )
    AND (
      (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at') IS NULL
      OR (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at')::timestamptz
           < pg_catalog.now() - pg_catalog.make_interval(days => p_cooldown_days)
    )
    AND COALESCE((sca.submitted_to -> 'netcraft' ->> 'resubmit_count')::int, 0)
          < GREATEST(1, p_max_resubmits)
  )
  SELECT
    e.id,
    e.candidate_url,
    e.candidate_domain,
    e.inferred_target_domain,
    e.urlscan_uuid,
    e.weaponised_at,
    GREATEST(0, p_limit - (SELECT used.n FROM used))::int AS budget_remaining
  FROM elig e
  -- Rows are returned to be PROBED; budget_remaining is what may be submitted.
  WHERE e.rn <= GREATEST(0, COALESCE(p_probe_limit, p_limit))
    AND (SELECT used.n FROM used) < p_limit
  ORDER BY e.rn;
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer, integer) IS
  'v253. As v252, but the submission budget is per UTC day rather than a rolling 24h window — a fixed-time cron can never clear a rolling window its own previous run just wrote into, which made the lane fire every other day.';
