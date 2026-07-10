-- migration-v221-netcraft-issue-evidence-gate.sql
--
-- Clone-Watch — F4: evidence-gate the Netcraft false-negative reporter.
-- docs/plans/clone-watch-brand-value-features.md §F4.
--
-- Why (grounded in the 2026-07-10 reconciler cross-tab): Netcraft actions
-- live malicious content and declines everything else — parked → 0% actioned,
-- and we currently hold ZERO urlscan `likely_phishing` clones among the 752
-- reconciled. An ungated reporter going live would file low-confidence issues
-- on declined-parked domains — crying wolf that burns our finite reporter
-- standing. The gate aligns "high confidence" + "Netcraft will act" +
-- "protects standing" into one predicate:
--
--     urlscan_classification = 'likely_phishing'  (our independent verdict)
--  OR lifecycle_state       = 'weaponised'        (the recheck loop caught the
--                                                  parked→live-phishing flip)
--
-- Design choice — gate IN THE WORKLIST RPC, no terminal stamp: a gated-out
-- alert simply does not appear while unproven and RE-ENTERS AUTOMATICALLY the
-- moment it weaponises. A terminal `below_evidence_gate` stamp would
-- permanently exclude a later-weaponising alert (the worklist drains on ANY
-- netcraft_issue fragment), and a TS-side filter would either need that stamp
-- or break the "absence of the stamp is never the retry signal" convergence.
-- Gating here also means dry-run logs reflect exactly the gated set.
--
-- Also adds three evidence fields to the per-alert jsonb so the reporter can
-- (a) belt-and-braces re-assert the gate in TS (deploy-skew safety: new RPC +
-- old TS or vice versa fails CLOSED), and (b) cite the urlscan result URL as
-- evidence in the issue `reason` text. NOTE: the Netcraft report_issue payload
-- has NO screenshot/attachment field (verified against the live SPA bundle,
-- 2026-07-10) — evidence travels as text.
--
-- Same signature + return shape as v216 → CREATE OR REPLACE (no drop needed).
-- SECURITY DEFINER + search_path='' + fully-qualified per the v216 shape.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_issue(
  p_max_age_days integer DEFAULT 30,
  p_uuid_limit integer DEFAULT 20
)
RETURNS TABLE(
  netcraft_uuid text,
  alerts jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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
      AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= pg_catalog.now() - (p_max_age_days || ' days')::interval
      -- DRAIN-AWARE: an alert still needs filing only when its netcraft_issue
      -- fragment is absent OR non-terminal + retry-eligible + not in a
      -- recheck cool-down. COALESCE guards the NULL `?` result when the key is
      -- absent (NULL ? 'x' = NULL → treated as "not present" = still pending).
      AND NOT COALESCE(sca.submitted_to -> 'netcraft_issue' ? 'issue_reported_at', false)
      AND NOT COALESCE(sca.submitted_to -> 'netcraft_issue' ? 'skipped', false)
      AND NOT COALESCE(sca.submitted_to -> 'netcraft_issue' ? 'failed', false)
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
  -- oldest submission first (closest to eventual archival)
  ORDER BY min(p.submitted_at) ASC
  LIMIT GREATEST(1, p_uuid_limit);
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_issue(integer, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_issue(integer, integer) IS
  'uuid-atomic, drain-aware worklist for the Netcraft false-negative reporter. v221 adds the F4 evidence gate (urlscan likely_phishing OR lifecycle weaponised) — gated-out alerts stay pending-by-predicate (no stamp) and re-enter when they weaponise. Per-alert jsonb carries urlscan_classification / lifecycle_state / urlscan_uuid for the TS belt-and-braces gate + evidence citation.';
