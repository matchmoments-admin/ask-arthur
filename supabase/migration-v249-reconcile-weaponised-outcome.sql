-- migration-v249-reconcile-weaponised-outcome.sql
--
-- Clone-Watch — `re_taken_down` is structurally always zero.
--
-- The whole point of the F4 issue reporter is the vendor-gap story: "Netcraft
-- graded this lookalike `no threats`, we watched it turn into live phishing, we
-- pushed back, and it came down." We have filed 17 of those. We can prove the
-- outcome of exactly none of them, because nothing observes an alert once it
-- reaches `weaponised`:
--
--   list_clone_alerts_for_netcraft_reconcile (v224 §4)
--     WHERE lifecycle_state IN ('detected','monitoring','reported','declined')
--   list_clone_alerts_for_recheck (v224 §3)
--     WHERE lifecycle_state IN ('monitoring','declined')
--
-- The reconciler is the ONLY thing that maps a per-URL `malicious` to
-- taken_down and stamps submitted_to.netcraft.takedown_at. Weaponised alerts
-- never enter its worklist, so they can never advance, so
-- `escalated AND lifecycle_state='taken_down'` — the definition of
-- re_taken_down in report-brand-stewardship.ts — is unsatisfiable. Measured
-- 2026-07-26: all 17 filed alerts have zero clone_watch_scan_transitions after
-- their filing timestamp, and re_taken_down = 0 in every summary row.
--
-- The KPI code is already written and wired: computeDurationKpis' refileToTakedown
-- leg (apps/web/lib/clone-watch/duration-kpis.ts) reads
-- netcraft_issue.issue_reported_at → netcraft.takedown_at. It is starved, not
-- missing. Unblocking the reconciler populates it.
--
-- Three changes, all CREATE OR REPLACE with unchanged signatures — no drops.

-- ── 1. Let the reconciler see weaponised alerts ─────────────────────────────
-- Same body as v224 §4 (round-robin on reconciled_at) plus 'weaponised'.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_netcraft_reconcile(
  p_max_age_days integer DEFAULT 30,
  p_uuid_limit integer DEFAULT 60,
  p_cadence_hours integer DEFAULT 24
)
RETURNS TABLE(netcraft_uuid text, alerts jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH pending AS (
    SELECT
      sca.submitted_to -> 'netcraft' ->> 'uuid' AS uuid,
      (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz AS submitted_at,
      (sca.submitted_to -> 'netcraft' ->> 'reconciled_at')::timestamptz AS reconciled_at,
      pg_catalog.jsonb_build_object(
        'id', sca.id,
        'candidate_domain', sca.candidate_domain,
        'candidate_url', sca.candidate_url,
        'lifecycle_state', sca.lifecycle_state
      ) AS alert
    FROM public.shopfront_clone_alerts sca
    WHERE sca.submitted_to ? 'netcraft'
      AND sca.submitted_to -> 'netcraft' ->> 'uuid' IS NOT NULL
      -- v249: 'weaponised' joins the set. It is the ONLY way the
      -- escalation → takedown outcome can ever be witnessed. Downgrades are
      -- refused by apply_netcraft_reconcile below, so admitting it here is
      -- safe: a `no threats` on a weaponised row stamps reconciled_at only.
      AND sca.lifecycle_state IN
        ('detected', 'monitoring', 'reported', 'declined', 'weaponised')
      AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= pg_catalog.now() - (p_max_age_days || ' days')::interval
      AND (
        (sca.submitted_to -> 'netcraft' ->> 'reconciled_at') IS NULL
        OR (sca.submitted_to -> 'netcraft' ->> 'reconciled_at')::timestamptz
             <= pg_catalog.now() - (p_cadence_hours || ' hours')::interval
      )
  )
  SELECT
    p.uuid,
    pg_catalog.jsonb_agg(p.alert ORDER BY (p.alert ->> 'id')::bigint)
  FROM pending p
  GROUP BY p.uuid
  -- Round-robin: never-reconciled uuids first, then least-recently reconciled.
  ORDER BY min(p.reconciled_at) ASC NULLS FIRST, min(p.submitted_at) ASC
  LIMIT GREATEST(1, p_uuid_limit);
$function$;

-- ── 2. Refuse downgrades; stamp the re-takedown ─────────────────────────────
-- v219's docstring for the RECONCILER claimed "It NEVER downgrades weaponised/
-- taken_down/dormant (the worklist RPC excludes them)". Change 1 makes that
-- claim false, so the guard has to move from the worklist into the write. Three
-- additions over v219, everything else byte-identical:
--
--   a. lifecycle_state: a row already in weaponised/taken_down/dormant only
--      moves for p_to_state='taken_down'. Nothing walks it back to 'declined'.
--   b. netcraft_declined_at: never re-stamped on an already-weaponised row —
--      that column feeds the decline→weaponise duration KPI, and a post-hoc
--      re-stamp would invert the leg and land in anomalousInversionsN.
--   c. netcraft.re_takedown_at: stamped alongside takedown_at when the row
--      carries netcraft_issue.issue_reported_at. That is the "we forced it
--      through" moment, and it is what makes the refileToTakedown median a
--      publishable number rather than a count.
--
-- The v219 WITNESSED-transition rule is preserved verbatim: takedown_at is only
-- stamped when the alert already carries a reconciled_at, so a first-touch
-- backfill of an already-actioned clone counts as taken_down without polluting
-- the timing metric. Every weaponised alert has a reconciled_at from before it
-- weaponised, so the escalation cohort is timed accurately from day one.
CREATE OR REPLACE FUNCTION public.apply_netcraft_reconcile(
  p_alert_ids bigint[],
  p_to_state text DEFAULT NULL,
  p_stamp_takedown boolean DEFAULT false
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET
      lifecycle_state = CASE
        WHEN sca.lifecycle_state IN ('weaponised', 'taken_down', 'dormant')
             AND COALESCE(p_to_state, '') <> 'taken_down'
        THEN sca.lifecycle_state
        ELSE COALESCE(p_to_state, sca.lifecycle_state)
      END,
      netcraft_declined_at = CASE
        WHEN p_to_state = 'declined'
             AND sca.lifecycle_state NOT IN ('weaponised', 'taken_down', 'dormant')
        THEN pg_catalog.now()
        ELSE sca.netcraft_declined_at
      END,
      alert_state = CASE WHEN p_to_state = 'taken_down' THEN 'taken_down'
                         ELSE sca.alert_state END,
      submitted_to = pg_catalog.jsonb_set(
        CASE
          -- Stamp takedown_at only for a WITNESSED transition: first-touch AND we
          -- have observed this alert before (reconciled_at present). A first-ever
          -- observation of an already-malicious clone (backfill) is left unstamped
          -- so it counts as taken_down but never skews the time-to-takedown KPI.
          WHEN p_stamp_takedown
               AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
               AND (sca.submitted_to -> 'netcraft' ->> 'reconciled_at') IS NOT NULL
          THEN pg_catalog.jsonb_set(
                 -- v249: an escalated alert additionally records WHEN the
                 -- push-back landed, so escalation→takedown is measurable
                 -- directly and not inferred from two unrelated stamps.
                 CASE
                   WHEN (sca.submitted_to -> 'netcraft_issue' ->> 'issue_reported_at') IS NOT NULL
                   THEN pg_catalog.jsonb_set(
                          sca.submitted_to, '{netcraft,re_takedown_at}',
                          pg_catalog.to_jsonb(pg_catalog.now()::text), true)
                   ELSE sca.submitted_to
                 END,
                 '{netcraft,takedown_at}',
                 pg_catalog.to_jsonb(pg_catalog.now()::text), true)
          ELSE sca.submitted_to
        END,
        '{netcraft,reconciled_at}',
        pg_catalog.to_jsonb(pg_catalog.now()::text), true
      ),
      updated_at = pg_catalog.now()
    WHERE sca.id = ANY(p_alert_ids)
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE EXECUTE ON FUNCTION public.apply_netcraft_reconcile(bigint[], text, boolean)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.apply_netcraft_reconcile(bigint[], text, boolean) IS
  'v249. Witnessed-transition takedown stamping (v219) + refuses to downgrade weaponised/taken_down/dormant + stamps netcraft.re_takedown_at when the row was escalated via netcraft_issue. Weaponised rows entered the reconcile worklist in v249 so the escalation outcome can be measured.';

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_netcraft_reconcile(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
