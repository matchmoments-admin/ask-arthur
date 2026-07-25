-- migration-v250-netcraft-weaponised-resubmit.sql
--
-- Clone-Watch — 23 weaponised clones have no Netcraft submission to escalate.
--
-- The F4 issue reporter files `report_issue` against an EXISTING submission
-- uuid. That is the only escalation path we have, and it needs three things:
-- a submission, a submission inside the reporter's 30-day window, and an
-- unspent issue slot. Measured on prod 2026-07-26, of 54 weaponised alerts:
--
--   3   never submitted to Netcraft at all
--   20  submitted, but the submission has aged past 30 days (report_issue
--       404s forever once Netcraft archives it)
--   ──
--   23  stranded — 43% of the weaponised population, with NO path to Netcraft
--       17 of them never successfully escalated, across 14 AU brands:
--       auspost, qantas, kmart, target, stgeorge, citibank, aldi, zip,
--       coinbase, revolut, whatsapp, gluestore, hellostake, toyworld
--
-- clone-watch-submit-netcraft dedupes on `submitted_to.netcraft` already
-- existing, so there is no path to a fresh report either. These alerts are
-- simply dropped.
--
-- A fresh submission is also the STRONGER move: it carries our urlscan
-- phishing evidence, whereas report_issue argues against a verdict Netcraft
-- has already recorded.
--
-- Ships DARK behind FF_CLONE_NETCRAFT_RESUBMIT (default OFF) with its own
-- daily cap and its own feature_brakes.clone_netcraft_resubmit, so it can be
-- killed without touching the issue reporter.
-- See docs/plans/clone-watch-brand-value-features.md §F4.

-- ── 1. Worklist ─────────────────────────────────────────────────────────────
-- Deliberately EXCLUDES alerts that already carry netcraft_issue.issue_reported_at.
-- Those 6 were successfully escalated once; re-pointing them at a new uuid would
-- make computeDurationKpis' refileToTakedown leg measure old-issue →
-- new-submission-takedown, silently conflating two mechanisms in the one number
-- we intend to publish. The gap this closes is "no path at all", not "a second
-- bite".
--
-- Reporter standing is the real risk here — re-filing a URL Netcraft has graded
-- is how a submitter gets ignored. Four independent bounds: weaponised-only
-- (our own scan witnessed phishing), a per-alert cooldown, a hard per-alert
-- resubmit ceiling, and a 24h global budget folded into the LIMIT so re-firing
-- the manual trigger cannot exceed the day's allowance (the v185 pattern).
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(
  p_limit integer DEFAULT 10,
  p_min_age_days integer DEFAULT 30,
  p_cooldown_days integer DEFAULT 14,
  p_max_resubmits integer DEFAULT 3
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  urlscan_uuid text,
  weaponised_at timestamptz
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
  )
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.urlscan_uuid,
    sca.weaponised_at
  FROM public.shopfront_clone_alerts sca, used
  WHERE sca.lifecycle_state = 'weaponised'
    AND sca.candidate_url IS NOT NULL
    -- No usable submission: never submitted, malformed, or aged out of the
    -- reporter's window.
    AND (
      NOT (sca.submitted_to ? 'netcraft')
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at') IS NULL
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
           < pg_catalog.now() - pg_catalog.make_interval(days => p_min_age_days)
    )
    -- COALESCE is load-bearing: `?` against a MISSING netcraft_issue key
    -- returns NULL, not false, and a NULL here would silently drop the 12
    -- alerts the v248 backfill un-stamped — the largest slice of the cohort.
    AND NOT COALESCE(sca.submitted_to -> 'netcraft_issue' ? 'issue_reported_at', false)
    AND (
      (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at') IS NULL
      OR (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at')::timestamptz
           < pg_catalog.now() - pg_catalog.make_interval(days => p_cooldown_days)
    )
    AND COALESCE((sca.submitted_to -> 'netcraft' ->> 'resubmit_count')::int, 0)
          < GREATEST(1, p_max_resubmits)
  -- Freshest attacks first: a clone that weaponised today is still live and
  -- still taking victims; a 60-day-old one probably is not.
  ORDER BY sca.weaponised_at DESC NULLS LAST, sca.id ASC
  LIMIT GREATEST(0, LEAST(p_limit, p_limit - used.n));
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer) IS
  'v250. Weaponised clones with NO usable Netcraft submission (never submitted, or aged past the issue reporter''s 30-day window) and never successfully escalated. Bounded by a per-alert cooldown, a per-alert resubmit ceiling and a 24h global budget folded into the LIMIT.';

-- ── 2. Record the resubmission ──────────────────────────────────────────────
-- submitted_to.netcraft stays the ONE current submission per alert — both the
-- reconciler and the issue reporter key off netcraft.uuid, so a second
-- top-level key would give the alert two competing Netcraft identities. The
-- superseded submission is pushed onto netcraft.prior[] instead, so the history
-- (and any takedown_at it earned) is preserved rather than overwritten.
--
-- reconciled_at is CARRIED FORWARD deliberately. v219's witnessed-transition
-- rule only stamps takedown_at when a reconciled_at already exists; dropping it
-- here would make the first post-resubmit reconcile pass read as backfill and
-- silently exclude a real, timed takedown from the duration KPI.
--
-- netcraft_issue is CLEARED (when unfiled). That stamp describes the OLD
-- submission — its uuid, its `unavailable` grading, its exhausted rounds. Left
-- in place, a `skipped` key would make the alert invisible to the issue
-- reporter's worklist forever, so the fresh submission could never be escalated
-- if Netcraft declines it too. This is the read-gate rule the v224 incident
-- taught: a re-submit path must move the row back across the exact predicate
-- its consuming stage filters on. Rows carrying issue_reported_at are never
-- selected by the worklist above, but the guard is explicit here so the RPC is
-- safe to call directly.
CREATE OR REPLACE FUNCTION public.record_clone_alert_netcraft_resubmit(
  p_alert_ids bigint[],
  p_uuid text,
  p_state text DEFAULT NULL
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
      COALESCE(sca.submitted_to -> 'netcraft', '{}'::jsonb) AS nc
    FROM public.shopfront_clone_alerts sca
    WHERE sca.id = ANY(p_alert_ids)
  ),
  built AS (
    SELECT
      cur.id,
      cur.st,
      pg_catalog.jsonb_build_object(
        'prior',
        COALESCE(cur.nc -> 'prior', '[]'::jsonb)
        || CASE
             WHEN (cur.nc - 'prior') = '{}'::jsonb THEN '[]'::jsonb
             ELSE pg_catalog.jsonb_build_array(cur.nc - 'prior')
           END,
        'uuid', pg_catalog.to_jsonb(p_uuid),
        'state', pg_catalog.to_jsonb(p_state),
        'submitted_at', pg_catalog.to_jsonb(pg_catalog.now()::text),
        'resubmitted_at', pg_catalog.to_jsonb(pg_catalog.now()::text),
        'resubmit_count',
        pg_catalog.to_jsonb(COALESCE((cur.nc ->> 'resubmit_count')::int, 0) + 1),
        'via', pg_catalog.to_jsonb('weaponised_resubmit'::text)
      )
      -- Preserve the witnessed-transition anchor (see header).
      || CASE
           WHEN cur.nc ? 'reconciled_at'
           THEN pg_catalog.jsonb_build_object('reconciled_at', cur.nc -> 'reconciled_at')
           ELSE '{}'::jsonb
         END AS nc
    FROM cur
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET submitted_to = pg_catalog.jsonb_set(
          CASE
            WHEN COALESCE(built.st -> 'netcraft_issue' ? 'issue_reported_at', false)
            THEN built.st
            ELSE built.st - 'netcraft_issue'
          END,
          ARRAY['netcraft'],
          built.nc,
          true
        ),
        updated_at = pg_catalog.now()
    FROM built
    WHERE sca.id = built.id
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_clone_alert_netcraft_resubmit(bigint[], text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.record_clone_alert_netcraft_resubmit(bigint[], text, text) IS
  'v250. Records a fresh Netcraft submission for a weaponised clone: pushes the superseded submission onto netcraft.prior[], keeps netcraft as the single current submission, carries reconciled_at forward (v219 witnessed rule) and clears a stale unfiled netcraft_issue stamp so the new uuid is escalatable.';
