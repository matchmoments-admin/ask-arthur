-- Migration v287 — the Netcraft issue reporter allowed ONE escalation per
-- alert, ever. A re-submitted clone could never be escalated on its new uuid.
--
-- This is finding R5 from the 2026-08-23 architecture review, left unfixed when
-- v284/v285 shipped. Confirmed against prod before writing:
--
--   escalated at least once ...................................... 69
--   ├─ of those, later RE-SUBMITTED (new Netcraft uuid) ......... 42
--   ├─ carrying a submission NEWER than their issue report ...... 22
--   └─ of those, STILL lifecycle_state='weaponised' ............. 17
--
-- So 17 live phishing clones hold a fresh Netcraft submission that the issue
-- lane is structurally incapable of escalating. The v250 resubmit lane mints a
-- new uuid for exactly this purpose and then the escalation stage ignores it.
--
-- MECHANISM. `list_clone_alerts_pending_netcraft_issue` gates on three stamps
-- that live on the ALERT, not the submission:
--     NOT (netcraft_issue ? 'issue_reported_at')
--     NOT (netcraft_issue ? 'skipped')
--     NOT (netcraft_issue ? 'failed')
-- `record_clone_alert_netcraft_resubmit` (v250) deliberately PRESERVES
-- netcraft_issue when issue_reported_at is present, so a resubmit moves the row
-- across `netcraft.uuid` but not back across the predicate the issue stage
-- filters on. That is the v224 lesson verbatim, in a lane nobody re-checked:
-- "a re-submit path must move the row back across the exact predicate its
-- retrieve/consume stage filters on, or the loop silently does nothing."
--
-- FIX. Scope the stamps to the submission they were made against: re-admit an
-- alert whose current `netcraft.submitted_at` is LATER than its last issue
-- decision. Every stamp shape carries a usable timestamp — verified in prod,
-- not assumed: all 69 reported rows have `issue_reported_at`, and all 44
-- skipped rows have `at`. `netcraft.submitted_at` is non-NULL on every
-- escalated row (0/69 NULL) and IS updated by the resubmit path (the
-- submitted-after-issue and resubmitted-after-issue counts are both 22), so
-- the comparison is exact for this data model rather than merely indicative.
-- No uuid needs stamping.
--
-- NULL-safety, since this repo keeps getting bitten: the timestamp comparison
-- sits in the SECOND disjunct only. A row with no stamp at all is admitted by
-- the FIRST disjunct, so a NULL `decided_at` can never hide a never-escalated
-- row (`NULL > x` is NULL, not false, and would otherwise exclude it).
--
-- DELIBERATELY NOT CHANGED: the `attempts < 3` and `recheck_after` gates are
-- also per-alert and will carry across a resubmit. Measured: every row with a
-- netcraft_issue stamp has attempts = 0 (117/117), so neither gate blocks
-- anything today. Scoping them per-submission on that evidence would be
-- speculative; noted here so the next reader knows it was checked, not missed.
--
-- Signature and row type unchanged -> plain CREATE OR REPLACE. Idempotent.
-- Keeps `SET search_path TO ''` and the fully-qualified style of v221.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_issue(
  p_max_age_days integer DEFAULT 30,
  p_uuid_limit integer DEFAULT 20
)
RETURNS TABLE(netcraft_uuid text, alerts jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH pending AS (
    SELECT
      sca.submitted_to -> 'netcraft' ->> 'uuid' AS uuid,
      (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz AS submitted_at,
      pg_catalog.jsonb_build_object(
        'id', sca.id,
        'candidate_url', sca.candidate_url,
        'candidate_domain', sca.candidate_domain,
        'inferred_target_domain', sca.inferred_target_domain,
        'target_brand_normalized', sca.target_brand_normalized,
        'urlscan_classification', sca.urlscan_classification,
        'lifecycle_state', sca.lifecycle_state,
        'urlscan_uuid', sca.urlscan_evidence ->> 'uuid'
      ) AS alert
    FROM public.shopfront_clone_alerts sca
    WHERE sca.submitted_to ? 'netcraft'
      AND sca.submitted_to -> 'netcraft' ->> 'uuid' IS NOT NULL
      AND sca.inferred_target_domain IS NOT NULL
      AND COALESCE(sca.triage_status, '') <> 'fp'
      AND lower(sca.inferred_target_domain) NOT IN
        ('domain.com.au', 'allhomes.com.au', 'lendi.com.au')
      -- F4 EVIDENCE GATE (v221): only escalate high-confidence clones —
      -- urlscan-confirmed phishing or a witnessed weaponisation. Everything
      -- else stays pending-by-predicate (NOT stamped) and re-enters the
      -- worklist automatically if it later weaponises.
      AND (
        sca.urlscan_classification = 'likely_phishing'
        OR sca.lifecycle_state = 'weaponised'
      )
      -- v287: never escalate a RESOLVED clone. The evidence gate above admits
      -- on `urlscan_classification='likely_phishing'` alone, so a taken_down
      -- alert that was once phishing still satisfies it — harmless while the
      -- per-alert stamp blocked everything, but re-admitting by submission
      -- surfaced 5 such alerts across 4 uuids. The TS reporter would have
      -- drained them as `no_escalatable_state` after fetching each uuid from
      -- Netcraft, so this is wasted API calls rather than a wrong report, but
      -- filing "you missed this" on a URL Netcraft has already actioned is
      -- exactly the reporter-standing problem v284 set out to stop.
      AND sca.lifecycle_state NOT IN ('taken_down', 'dormant')
      AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= pg_catalog.now() - (p_max_age_days || ' days')::interval
      -- v287: the three terminal stamps are scoped to the SUBMISSION they were
      -- made against, not to the alert for all time.
      AND (
        -- (a) no issue decision has ever been made on this alert
        (
          NOT COALESCE(sca.submitted_to -> 'netcraft_issue' ? 'issue_reported_at', false)
          AND NOT COALESCE(sca.submitted_to -> 'netcraft_issue' ? 'skipped', false)
          AND NOT COALESCE(sca.submitted_to -> 'netcraft_issue' ? 'failed', false)
        )
        -- (b) or the decision was made against an EARLIER submission, and the
        --     v250 resubmit lane has since minted a new uuid worth escalating.
        OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
             > COALESCE(
                 (sca.submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz,
                 (sca.submitted_to -> 'netcraft_issue' ->> 'at')::timestamptz
               )
      )
      AND COALESCE((sca.submitted_to -> 'netcraft_issue' ->> 'attempts')::int, 0) < 3
      AND (
        (sca.submitted_to -> 'netcraft_issue' ->> 'recheck_after') IS NULL
        OR (sca.submitted_to -> 'netcraft_issue' ->> 'recheck_after')::timestamptz
             <= pg_catalog.now()
      )
  )
  SELECT
    p.uuid,
    pg_catalog.jsonb_agg(p.alert ORDER BY (p.alert ->> 'id')::bigint)
  FROM pending p
  GROUP BY p.uuid
  ORDER BY min(p.submitted_at) ASC
  LIMIT GREATEST(1, p_uuid_limit);
$function$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_pending_netcraft_issue(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_issue(integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_issue(integer, integer) IS
  'Netcraft false-negative escalation worklist. v221 evidence gate (likely_phishing OR weaponised). v287: the issue_reported_at/skipped/failed stamps are scoped to the submission they were made against, so a clone re-submitted by the v250 lane can be escalated on its new uuid — previously one escalation per alert, ever, stranding 17 live weaponised clones.';
