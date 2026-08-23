-- Migration v285 — urlscan submit lane: stop losing the pre-weaponisation tail
--
-- WHY (measured against prod 2026-08-23, not inferred from code):
--
--   924 of 2,786 clone alerts have NEVER received a urlscan verdict. 422 of
--   those are rows the preclassifier scored as a clone at confidence >= 0.7.
--
--     retired at urlscan_failure_streak >= 3 ...... 282  (281 high-confidence)
--     never attempted ............................. 532  ( 44 high-confidence)
--     in flight (streak 1-2) ...................... 110  ( 97 high-confidence)
--
--   269 of the 282 retired rows failed with `400 - "DNS Error - Could not
--   resolve domain"`. I resolved a random sample of 70 of those domains on
--   2026-08-23: **30 (43%) resolve today** — deutschebnk.org, kraken-login.org,
--   noreply-supportfacebook.com, amazon-business-service.shop, amaz0n.plus,
--   hsbc.co.mw among them.
--
--   That is the premise of clone-watch failing. A newly-registered domain that
--   does not resolve YET is not a dead lead — it is the pre-weaponisation state
--   this feature exists to watch. We retired it after three attempts and never
--   looked again, and nearly half came alive.
--
--   This matters more now than it did last week: v284 made Netcraft submission
--   REQUIRE a urlscan verdict, so an alert with no verdict can no longer ever
--   be reported at all. urlscan coverage is now load-bearing.
--
-- TWO DEFECTS, BOTH FIXED HERE.
--
-- D1 — NXDOMAIN was treated as death. `record_clone_alert_urlscan_submit`
-- bumps urlscan_failure_streak on any non-429 failure. v279 added a 7-day
-- retry cadence for status=400 rows, but the `urlscan_failure_streak <
-- p_max_failure_streak` gate still killed them after ~3 attempts, defeating it.
-- The repo already draws exactly this distinction for 429s ("Quota exhaustion
-- is NOT URL death", apps/web/lib/clone-watch/urlscan-submit-one.ts:112). A 400
-- is not evidence about the URL either — it says the domain has no DNS yet.
-- Now: non-400 failures keep the 3-strike rule; a 400 does not count toward
-- death and simply waits out the v279 dead cadence. The horizon below is its
-- only bound. No data migration is needed — the predicate change alone
-- re-admits the retired rows, which also makes this fully reversible.
--
-- D2 — LIFO starvation plus a hard 14-day cutoff. `ORDER BY first_seen_at DESC`
-- against SUBMIT_BATCH_LIMIT=30 and ~29 alerts/day (bursting to 46) meant fresh
-- alerts won every slot. A passed-over row was never stamped, so it never
-- "failed" — it was just perpetually outranked, and then `first_seen_at >=
-- now() - interval '14 days'` dropped it permanently. Nothing anywhere
-- re-offered it: submit had aged it out, retrieve needs a urlscan_uuid, and
-- recheck gates on lifecycle_state IN ('monitoring','declined'). Now: the
-- horizon matches recheck's 90 days, and a third of each batch is RESERVED for
-- the oldest eligible rows — the STALE_FLOOR_SHARE shape that already exists in
-- clone-watch-lifecycle-recheck.ts:42-48 for this exact starvation mode.
--
-- QUOTA (settled 2026-08-23 — this check had never been run). The ops doc
-- recorded "free tier: 100 scans/day, UNVERIFIED". Actual entitlement on the
-- production key: **unlisted 1,000/day** (35 used that day), public 5,000/day,
-- retrieve 10,000/day. The documented figure was wrong by 10x, so the batch
-- limit rising 30 -> 75 leaves us at roughly a quarter of the real ceiling.
-- The binding constraint is the fn's 200s wall clock, not urlscan.
--
-- Signature is UNCHANGED, so this is a plain CREATE OR REPLACE with no DROP —
-- v279 had to drop because it ADDED p_dead_cadence_hours. The stale-floor share
-- is derived from p_limit rather than taken as a new argument precisely to
-- avoid that (and the overload-ambiguity trap v284 documents).
--
-- Idempotent: CREATE OR REPLACE only. No UPDATE, no DDL on any table.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan_submit(
  p_limit integer DEFAULT 30,
  p_min_confidence real DEFAULT 0.7,
  p_max_failure_streak integer DEFAULT 3,
  p_dead_cadence_hours integer DEFAULT 168
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH bounds AS (
    SELECT
      GREATEST(1, LEAST(p_limit, 100)) AS cap,
      -- One third of every batch is reserved for the oldest eligible rows so
      -- fresh inflow can never again starve the backlog to death (D2).
      GREATEST(1, LEAST(p_limit, 100) / 3) AS stale_slots
  ),
  eligible AS (
    SELECT
      sca.id,
      sca.candidate_url,
      sca.candidate_domain,
      sca.inferred_target_domain,
      sca.first_seen_at
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      AND sca.urlscan_uuid IS NULL
      -- v285 (D1): a 400 means "no DNS yet", which is the state we are here to
      -- watch — it must not count toward the death streak. Everything else
      -- keeps the 3-strike rule unchanged.
      AND (
        sca.urlscan_evidence ->> 'status' = '400'
        OR sca.urlscan_failure_streak < p_max_failure_streak
      )
      -- v285 (D2): 14 days -> 90 days, matching list_clone_alerts_for_recheck.
      AND sca.first_seen_at >= now() - interval '90 days'
      -- v279: a domain urlscan refused with a 400 (no DNS) waits out a long
      -- cadence before it is offered a slot again. Not an exclusion — a 400 is
      -- not permanent, and the row returns on its own once the cadence lapses.
      AND (
        sca.urlscan_evidence ->> 'status' IS DISTINCT FROM '400'
        OR sca.urlscan_evidence ->> 'attempted_at' IS NULL
        OR (sca.urlscan_evidence ->> 'attempted_at')::timestamptz
           < now() - make_interval(hours => GREATEST(1, p_dead_cadence_hours))
      )
      AND EXISTS (
        SELECT 1
        FROM public.clone_watch_classifications c
        WHERE c.alert_id = sca.id
          AND c.is_clone
          AND c.confidence >= p_min_confidence
      )
  ),
  ranked AS (
    SELECT
      e.*,
      row_number() OVER (ORDER BY e.first_seen_at DESC) AS fresh_rank,
      row_number() OVER (ORDER BY e.first_seen_at ASC)  AS stale_rank
    FROM eligible e
  )
  SELECT
    r.id,
    r.candidate_url,
    r.candidate_domain,
    r.inferred_target_domain
  FROM ranked r
  CROSS JOIN bounds b
  WHERE r.stale_rank <= b.stale_slots
     OR r.fresh_rank <= b.cap - b.stale_slots
  ORDER BY
    -- Reserved-stale rows go FIRST. They are the ones at risk of crossing the
    -- 90-day horizon; today's fresh rows will still be eligible tomorrow. This
    -- also means the fn's wall-clock break can never re-create the starvation.
    (r.stale_rank <= b.stale_slots) DESC,
    CASE WHEN r.stale_rank <= b.stale_slots
         THEN r.stale_rank    -- within the reserve: oldest first
         ELSE r.fresh_rank    -- within the remainder: newest first
    END ASC
  LIMIT (SELECT cap FROM bounds);
$function$;

COMMENT ON FUNCTION public.list_clone_alerts_pending_urlscan_submit(integer, real, integer, integer) IS
  'urlscan first-scan worklist. v285: a 400 (no DNS) no longer counts toward the failure streak — 43%% of DNS-retired domains were measured live again months later; horizon 14d->90d; one third of each batch reserved for the oldest rows to end LIFO starvation.';

-- ---------------------------------------------------------------------------
-- v285 — give `dormant` its first writer.
--
-- `dormant` has been in the lifecycle_state CHECK constraint since v199, has
-- readers (UI badges, NO_DOWNGRADE_STATES in netcraft-urls.ts), and carries the
-- comment "NXDOMAIN for N re-checks / domain dropped" — but NOTHING has ever
-- written it. Meanwhile a row that ages past the submit horizon while still
-- unscanned leaves every worklist silently: submit ages it out, retrieve needs
-- a uuid, recheck gates on monitoring/declined.
--
-- Without this, widening the horizon to 90 days would only RELOCATE that silent
-- drop from day 14 to day 90. Stamping the row makes abandonment explicit,
-- countable, and consistent with the repo's "no silent caps" rule — the lane
-- can now report how many alerts it gave up on, instead of them just vanishing.
--
-- Bounded per call and safe to re-run: rows already dormant no longer match.

CREATE OR REPLACE FUNCTION public.mark_stale_clone_alerts_dormant(
  p_horizon_days integer DEFAULT 90,
  p_min_confidence real DEFAULT 0.7,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    SELECT sca.id
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      AND sca.lifecycle_state = 'detected'
      AND sca.urlscan_uuid IS NULL
      AND sca.urlscan_classification IS NULL
      AND sca.first_seen_at
          < now() - make_interval(days => GREATEST(1, p_horizon_days))
      AND EXISTS (
        SELECT 1
        FROM public.clone_watch_classifications c
        WHERE c.alert_id = sca.id
          AND c.is_clone
          AND c.confidence >= p_min_confidence
      )
    ORDER BY sca.first_seen_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 2000))
  )
  UPDATE public.shopfront_clone_alerts t
  SET lifecycle_state = 'dormant'
  FROM stale
  WHERE t.id = stale.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- This one MUTATES lifecycle_state, so it must not be reachable by anon or
-- authenticated. (Caught by the security advisor as
-- anon_security_definer_function_executable on first apply — CREATE OR REPLACE
-- preserves grants, but a brand-new SECURITY DEFINER function inherits the
-- permissive default.) Matches the v272/v279 convention for this family.
REVOKE ALL ON FUNCTION public.mark_stale_clone_alerts_dormant(integer, real, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_clone_alerts_dormant(integer, real, integer)
  TO service_role;

COMMENT ON FUNCTION public.mark_stale_clone_alerts_dormant(integer, real, integer) IS
  'v285: retires high-confidence alerts that aged past the urlscan submit horizon while still unscanned. First and only writer of lifecycle_state=dormant, which had readers but no writer since v199.';
