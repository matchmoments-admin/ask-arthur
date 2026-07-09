-- migration-v215-clone-netcraft-issue.sql
--
-- Clone-Watch — Netcraft false-negative auto-escalation (PR1, detect-only).
--
-- Netcraft grades on LIVE content, so branded lookalikes that are parked /
-- cloaked / pre-weaponisation at scan time come back non-malicious. Worse,
-- our bulk submitter sends ≤50 URLs under ONE submission uuid, and the
-- submission-level `state` is a rollup that reads "malicious" if ANY url in the
-- batch is malicious — so the branded lookalikes that individually came back
-- `no threats` / `unavailable` are invisible unless you read the PER-URL state
-- from GET /submission/{uuid}/urls. This feature reads that per-URL truth and
-- (in a later PR) files a "report an issue" on the branded false negatives.
--
-- This migration adds the two service-role RPCs the Inngest reader needs:
--   1. list_clone_alerts_pending_netcraft_issue — the worklist: alerts we
--      submitted to Netcraft (have a uuid) that we have NOT yet filed/skipped an
--      issue for, are branded (real target), not FP-denylisted, and are still
--      inside the pre-archival window. Oldest-submitted first (closest to
--      Netcraft archival → file before the /report_issue endpoint 404s).
--   2. count_todays_netcraft_issues — the dedicated daily-cap counter (distinct
--      submission uuids we've issue-reported today). Kept SEPARATE from
--      count_todays_takedown_submissions: an issue report is a distinct action
--      from a new-URL takedown submission, so it gets its own cap.
--
-- Idempotency marker: the reader stamps the alert's submitted_to under the
-- SIBLING top-level key `netcraft_issue` (NOT `netcraft`). merge_clone_alert_
-- submission does jsonb_set(..., ARRAY[p_key], ...) which REPLACES the whole
-- key, so writing under `netcraft` would obliterate uuid/state/via that the
-- poll + v185 daily-cap counter depend on. `netcraft_issue` is an atomic,
-- race-free sibling.
--
-- Both are LANGUAGE sql (so #variable_conflict does not apply), STABLE,
-- SECURITY DEFINER with SET search_path = public, pg_catalog (matches the
-- sibling clone RPCs; the empty form would hide operators). EXECUTE revoked
-- from PUBLIC/anon/authenticated — service-role reader only. Mirror of v185
-- list_clone_alerts_pending_netcraft_auto (inverse filter). Idempotent
-- CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_issue(
  p_max_age_days integer DEFAULT 14,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  target_brand_normalized text,
  netcraft_uuid text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.target_brand_normalized,
    sca.submitted_to -> 'netcraft' ->> 'uuid'
  FROM public.shopfront_clone_alerts sca
  WHERE sca.submitted_to ? 'netcraft'
    AND sca.submitted_to -> 'netcraft' ->> 'uuid' IS NOT NULL
    -- not yet issue-filed OR skipped (both stamp the netcraft_issue sibling key)
    AND NOT (sca.submitted_to ? 'netcraft_issue')
    -- must have a real impersonation target + not FP-triaged / FP-denylisted
    AND sca.inferred_target_domain IS NOT NULL
    AND COALESCE(sca.triage_status, '') <> 'fp'
    AND lower(sca.inferred_target_domain) NOT IN
      ('domain.com.au', 'allhomes.com.au', 'lendi.com.au')
    -- pre-archival soft window (authoritative skip is is_archived at fetch time)
    AND (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
          >= now() - (p_max_age_days || ' days')::interval
  -- oldest-submitted first: closest to Netcraft archival, file those before the
  -- /report_issue endpoint starts returning 404 "this submission has been archived"
  ORDER BY (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz ASC
  LIMIT GREATEST(1, p_limit);
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_issue(integer, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_todays_netcraft_issues()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(
    count(DISTINCT sca.submitted_to -> 'netcraft' ->> 'uuid'),
    0
  )::int
  FROM public.shopfront_clone_alerts sca
  WHERE sca.submitted_to ? 'netcraft_issue'
    AND (sca.submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz
          >= date_trunc('day', now());
$function$;

REVOKE EXECUTE ON FUNCTION public.count_todays_netcraft_issues()
  FROM PUBLIC, anon, authenticated;
