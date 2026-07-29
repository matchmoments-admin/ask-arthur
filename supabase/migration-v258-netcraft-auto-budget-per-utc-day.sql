-- migration-v258-netcraft-auto-budget-per-utc-day.sql
--
-- Clone-Watch — the AUTO lane has been running at half throughput for weeks.
--
-- Same defect v253 fixed in the resubmit lane, in the older and much larger
-- lane: v185's daily-cap CTE counts `submitted_at > now() - interval '24 hours'`
-- — a ROLLING window anchored on the previous run's stamps — while the cron
-- fires at a fixed 09:30 UTC. Each run's own rows land ~30 seconds inside the
-- next run's window, so the cap is spent twice against the same submissions and
-- the lane can only use what the previous day left over.
--
-- Unlike the resubmit lane this one is fully visible in production, because
-- demand saturates the cap. Submissions per day:
--
--   Jul 19  20  21  22  23  24  25  26  27  28
--       14  36  14  36  14  36  14  36  14  36
--
-- Perfect alternation, every consecutive pair summing to exactly the 50 cap.
-- The cap is being applied per 48 hours, not per 24. Measured at the cron
-- instant on 2026-07-29 05:47 UTC, with the fix's effect computed alongside:
--
--   used_if_unfixed = 36  → budget 14
--   used_if_fixed   =  0  → budget 50
--   demand_ceiling  = 50  (the worklist's own hard cap; supply is not the limit)
--
-- So ~25 reports/day against a designed 50 — roughly 750 fewer clone reports to
-- Netcraft per month, for weeks, with nothing in telemetry marked wrong. Each
-- individual run looks correct; only the sequence is wrong.
--
-- The house already had the right shape the whole time: count_todays_netcraft_
-- issues() uses `>= date_trunc('day', now())`, which is why the issue reporter
-- never had this. v185 and the v250-lineage resubmit worklist each wrote their
-- own rolling version instead.
--
-- The rule this encodes: A PERIODIC JOB MUST NOT BOUND ITSELF ON A ROLLING
-- WINDOW IT WRITES INTO. Anchor the budget to the same period the schedule uses,
-- or the cadence and the bound cancel each other out.
--
-- Everything else is the deployed v185 definition verbatim (fetched from prod
-- via pg_get_functiondef, not retyped). Signature and return type unchanged, so
-- CREATE OR REPLACE suffices — no DROP, no caller change, no deploy.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_auto(
  p_min_confidence real DEFAULT 0.7,
  p_daily_cap integer DEFAULT 50
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  severity_tier text,
  signals jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH today AS (
    -- v258: per-UTC-day, not rolling-24h. `via = 'auto_bulk'` still scopes the
    -- budget to this lane, so manual and per-candidate submissions do not
    -- consume it.
    SELECT count(*)::int AS n
    FROM public.shopfront_clone_alerts
    WHERE submitted_to -> 'netcraft' ->> 'via' = 'auto_bulk'
      AND (submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= date_trunc('day', now())
  )
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.severity_tier,
    sca.signals
  FROM public.shopfront_clone_alerts sca
  WHERE sca.inferred_target_domain IS NOT NULL
    AND NOT (sca.submitted_to ? 'netcraft')
    AND COALESCE(sca.triage_status, '') <> 'fp'
    AND lower(sca.inferred_target_domain) NOT IN
      ('domain.com.au', 'allhomes.com.au', 'lendi.com.au')
    AND sca.first_seen_at >= now() - interval '180 days'
    AND EXISTS (
      SELECT 1
      FROM public.clone_watch_classifications c
      WHERE c.alert_id = sca.id
        AND c.is_clone
        AND c.confidence >= p_min_confidence
    )
  ORDER BY
    (SELECT max(c.confidence)
       FROM public.clone_watch_classifications c
       WHERE c.alert_id = sca.id AND c.is_clone) DESC NULLS LAST,
    sca.first_seen_at DESC
  LIMIT LEAST(
    GREATEST(0, p_daily_cap - (SELECT n FROM today)),
    50
  );
$function$;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_auto(real, integer) IS
  'v258. As v185, but the daily cap counts submissions per UTC day rather than over a rolling 24h window — a fixed-time cron can never clear a rolling window its own previous run just wrote into, which held this lane to 50 submissions per 48 hours (an observed 14/36 alternation) instead of 50/day.';
