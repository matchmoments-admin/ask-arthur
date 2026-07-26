-- migration-v252-resubmit-dead-deferral.sql
--
-- Clone-Watch — the resubmit lane starves itself on proved-dead rows.
--
-- Found pre-fire, hours before the v250/v251 lane's first live run. The
-- worklist rank-limits to the daily cap (10) BEFORE liveness is known; the
-- probe runs in TypeScript afterwards and dead rows are simply filtered out of
-- the batch. Nothing stamps them. Submitted rows leave the worklist for 14 days
-- (cooldown); dead rows come back at the HEAD of the ordering tomorrow, and
-- every day after, forever.
--
-- Measured on prod 2026-07-26 — of the 23 eligible alerts, 9 are NXDOMAIN
-- (qantase.exchange, whctsapp.icu, flipkrt-zip.shop, kkmartcentral.shop,
-- citibank-support.xyz, whats-app.blog, bank-onboarding-onerevolutapp-…com,
-- auspovst.cfd, toyworldaustraliadirect.shop). Projected without this fix:
--
--   day 1   4 dead in the top 10  →  6 submitted
--   day 2   7                     →  3
--   day 3   8                     →  2
--   day 4+  9                     →  1
--
-- Steady state: 9 of 10 daily slots spent on domains that no longer exist, and
-- the fraction only grows as more weaponised clones die. The lane keeps
-- returning ok:true throughout. That is the v224 failure class exactly — a row
-- the consuming stage cannot act on has to be moved OUT of the predicate the
-- worklist filters on, or the loop silently does nothing.
--
-- The issue reporter already solved this in v248 (bounded, non-terminal
-- deferral with a per-reason round counter). This is that shape, keyed under a
-- new top-level `submitted_to.netcraft_resubmit` object: it survives
-- record_clone_alert_netcraft_resubmit's `st - 'netcraft_issue'` strip, and it
-- cannot collide with the issue reporter's own bookkeeping.
--
-- See docs/plans/clone-watch-brand-value-features.md §F4 and
-- docs/ops/clone-watch-config.md.

-- ── 1. Bounded dead-deferral ────────────────────────────────────────────────
-- Non-terminal for p_max_rounds rounds, then a terminal `skipped` — at the
-- 7-day recheck the lane uses, exhaustion means five consecutive weekly probes
-- returned NXDOMAIN, i.e. ~35 days continuously gone. Absence of a stamp is
-- never the retry signal (the v224 lesson); the stamp's `recheck_after` is.
CREATE OR REPLACE FUNCTION public.defer_clone_alert_netcraft_resubmit(
  p_alert_ids bigint[],
  p_reason text,
  p_recheck_after timestamptz,
  p_max_rounds integer DEFAULT 5
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH cur AS (
    SELECT
      sca.id,
      COALESCE(sca.submitted_to, '{}'::jsonb) AS st,
      COALESCE(sca.submitted_to -> 'netcraft_resubmit', '{}'::jsonb) AS nr
    FROM public.shopfront_clone_alerts sca
    WHERE sca.id = ANY(p_alert_ids)
  ),
  nxt AS (
    SELECT
      cur.id,
      cur.st,
      cur.nr,
      COALESCE((cur.nr -> 'rounds' ->> p_reason)::int, 0) + 1 AS rounds
    FROM cur
  ),
  built AS (
    SELECT
      nxt.id,
      nxt.st,
      -- Preserve everything except the two keys this call owns.
      (nxt.nr - 'skipped' - 'recheck_after')
      || pg_catalog.jsonb_build_object(
           'rounds',
           pg_catalog.jsonb_set(
             COALESCE(nxt.nr -> 'rounds', '{}'::jsonb),
             ARRAY[p_reason],
             pg_catalog.to_jsonb(nxt.rounds),
             true
           ),
           'at', pg_catalog.to_jsonb(pg_catalog.now()::text)
         )
      || CASE
           WHEN nxt.rounds > GREATEST(1, p_max_rounds)
             THEN pg_catalog.jsonb_build_object('skipped', p_reason || '_exhausted')
           ELSE pg_catalog.jsonb_build_object(
                  'recheck_after',
                  pg_catalog.to_jsonb(
                    COALESCE(p_recheck_after, pg_catalog.now() + interval '7 days')::text
                  )
                )
         END AS nr
    FROM nxt
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET submitted_to = pg_catalog.jsonb_set(
          built.st,
          ARRAY['netcraft_resubmit'],
          built.nr,
          true
        ),
        updated_at = pg_catalog.now()
    FROM built
    WHERE sca.id = built.id
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE EXECUTE ON FUNCTION public.defer_clone_alert_netcraft_resubmit(bigint[], text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.defer_clone_alert_netcraft_resubmit(bigint[], text, timestamptz, integer) IS
  'v252. Bounded, non-terminal deferral for the Netcraft resubmit lane: sets submitted_to.netcraft_resubmit.recheck_after and bumps rounds.<reason>, converting to a terminal skipped=<reason>_exhausted past p_max_rounds. Stops proved-dead rows permanently occupying the worklist''s daily cap.';

-- ── 2. Worklist: over-fetch for probing, cap SUBMISSIONS ────────────────────
-- Two changes on top of v251, everything else verbatim.
--
-- (a) The deferral predicates above.
-- (b) p_probe_limit — liveness can only be established in the caller, so the
--     RPC must be allowed to return MORE rows than the day's budget or a batch
--     with dead rows in it can never fill the cap. The 24h budget still bounds
--     what may be SUBMITTED; it is returned as budget_remaining (identical on
--     every row) so the caller can slice the live rows to it. Without this the
--     first run after a dead-heavy day still under-fills.
--
-- The return type changes, so this needs a DROP first — CREATE OR REPLACE
-- cannot alter OUT parameters (42P13). Safe across the deploy window: PostgREST
-- resolves the currently-deployed 4-named-arg call against this signature via
-- the default, and the extra column is ignored by the old row type.
DROP FUNCTION IF EXISTS public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer);

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
    SELECT count(*) AS n
    FROM public.shopfront_clone_alerts sca
    WHERE (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at')::timestamptz
            > pg_catalog.now() - pg_catalog.make_interval(hours => 24)
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
    -- row. If it was filed, Netcraft never actioned it, and the submission has
    -- since aged out, then a fresh report is the ONLY path left and the alert
    -- is by definition one we already believed was serving phishing.
    AND (
      NOT (sca.submitted_to ? 'netcraft')
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at') IS NULL
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
           < pg_catalog.now() - pg_catalog.make_interval(days => p_min_age_days)
    )
    -- Already actioned → nothing to re-report. (An alert Netcraft took down
    -- leaves lifecycle_state='taken_down' and fails the predicate above, but a
    -- takedown_at with the row still weaponised is possible under the v249
    -- no-downgrade rule, so guard it explicitly.)
    AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
    -- v252: proved dead at probe. `->>` on a missing key yields NULL, so an
    -- alert that has never been deferred passes both predicates without a
    -- COALESCE. A terminal `skipped` is permanent by design; clearing it is an
    -- operator action (see the runbook) for the rare re-registered domain.
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
  -- Budget exhausted → return nothing, so a re-fired manual trigger cannot
  -- exceed the day's allowance (the v185 pattern, unchanged in intent).
  WHERE e.rn <= GREATEST(0, COALESCE(p_probe_limit, p_limit))
    AND (SELECT used.n FROM used) < p_limit
  ORDER BY e.rn;
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer, integer) IS
  'v252. Weaponised clones with NO usable Netcraft submission (never submitted, or aged past the issue reporter''s 30-day window), no recorded takedown, and not deferred as dead at probe — INCLUDING ones escalated once via report_issue, since a fresh report is their only remaining path. Returns up to p_probe_limit rows for liveness probing; budget_remaining carries the 24h submission allowance so proved-dead rows cannot consume the daily cap.';
