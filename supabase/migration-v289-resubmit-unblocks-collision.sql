-- Migration v289 — give uuid-collision-blocked weaponised clones a route out.
--
-- WHY (measured in prod 2026-08-24, after v287 went live).
--
-- v287 unlocked the escalation lane (worklist 0 -> 12 uuids) and its first run
-- filed 2 real issue reports. It also exposed the NEXT constraint: 12 alerts
-- drained as `submission_has_issue`. Accumulated total across all runs:
--
--   25 alerts, ALL lifecycle_state='weaponised' (i.e. live phishing),
--   stamped netcraft_issue.skipped='submission_has_issue'
--
-- Netcraft permits ONE issue per submission uuid. The pre-v284 auto lane
-- crammed 25-37 URLs into a single uuid (measured: 08-18 through 08-22 batches
-- were 25/28/31/37/30 URLs), so for those batches exactly one alert can ever be
-- escalated and every other one is stamped terminal. This is finding R3 from
-- the 2026-08-23 architecture review.
--
-- CLEARING THE STAMP WOULD ACHIEVE NOTHING. The uuid still carries an issue, so
-- a re-admitted alert simply re-drains on the next run. The only unblock is a
-- FRESH uuid, which only the v250 resubmit lane can mint.
--
-- AND THAT LANE COULD NOT REACH THEM. It gates on
-- `submitted_at < now() - p_min_age_days` (30). Ages of the 25 blocked alerts:
--
--     6-28 days ... 21 alerts   <- no route out, for up to 24 more days
--    30-54 days ...  4 alerts   <- eligible
--
-- So 21 live phishing clones sat in a dead zone: too young to resubmit, and
-- permanently unescalatable on the uuid they already have. That is finding R4
-- ("the 25-day escalation dead zone") from the same review, with real numbers.
--
-- THE FIX. Bypass the age gate for exactly these rows. The age gate exists to
-- give Netcraft time to act on a submission before we re-file — a sound rule.
-- But it protects nothing here: no amount of waiting makes the CURRENT uuid
-- escalatable, because the one issue it is allowed has already been filed
-- against a different alert in the same batch. For a collision-blocked row the
-- age gate is pure delay.
--
-- Downstream needs no change, and this was verified rather than assumed: a
-- resubmit updates `netcraft.submitted_at`, and v287's issue-worklist predicate
-- re-admits on `submitted_at > decided_at`. So a freshly-resubmitted alert
-- re-enters the escalation lane on its new uuid automatically.
--
-- Every existing cap still applies and is deliberately untouched: daily cap 10,
-- 14-day cooldown, max 3 resubmits per alert, the dead-row deferral, and the
-- takedown_at exclusion. The 21 drain over ~3 days, not in one burst.
--
-- Signature and row type unchanged -> plain CREATE OR REPLACE. Keeps v253's
-- `SET search_path TO ''` and its fully-qualified style. Idempotent.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(
  p_limit integer DEFAULT 10,
  p_min_age_days integer DEFAULT 30,
  p_cooldown_days integer DEFAULT 14,
  p_max_resubmits integer DEFAULT 3,
  p_probe_limit integer DEFAULT NULL::integer
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  urlscan_uuid text,
  weaponised_at timestamp with time zone,
  budget_remaining integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH used AS (
    -- v253: per-UTC-day, not rolling-24h. A fixed-time cron can never clear a
    -- rolling window it just wrote into.
    SELECT count(*) AS n
    FROM public.shopfront_clone_alerts sca
    WHERE (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at')::timestamptz
            >= pg_catalog.date_trunc('day', pg_catalog.now())
  ),
  elig AS (
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.urlscan_uuid,
    sca.weaponised_at,
    row_number() OVER (
      ORDER BY sca.weaponised_at DESC NULLS LAST, sca.id ASC
    ) AS rn
  FROM public.shopfront_clone_alerts sca
  WHERE sca.lifecycle_state = 'weaponised'
    AND sca.candidate_url IS NOT NULL
    AND (
      NOT (sca.submitted_to ? 'netcraft')
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at') IS NULL
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
           < pg_catalog.now() - pg_catalog.make_interval(days => p_min_age_days)
      -- v289: a clone blocked by uuid COLLISION skips the age wait. Netcraft
      -- allows one issue per submission uuid; this row shares a uuid whose
      -- issue was spent on a different alert, so it can never be escalated on
      -- its current submission no matter how long we wait. The age gate is
      -- meant to give the vendor time to act, not to strand a live phishing
      -- clone that has no route at all.
      OR sca.submitted_to -> 'netcraft_issue' ->> 'skipped' = 'submission_has_issue'
    )
    AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
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
  WHERE e.rn <= GREATEST(0, COALESCE(p_probe_limit, p_limit))
    AND (SELECT used.n FROM used) < p_limit
  ORDER BY e.rn;
$function$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer, integer) IS
  'Weaponised RE-submission worklist (v250/v253). v289: an alert blocked by Netcraft''s one-issue-per-uuid rule (netcraft_issue.skipped=submission_has_issue) bypasses the min-age wait — its current uuid can never be escalated, so waiting only strands live phishing. All other caps unchanged.';
