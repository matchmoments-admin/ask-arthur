-- migration-v216-clone-netcraft-issue-dead-letter.sql
--
-- Clone-Watch — Netcraft false-negative reporter HARDENING (PR2). Makes the
-- v215 reporter safe to run LIVE. Verified by ultracode review wf_300bd165-f03
-- + a live dry-run smoke test. All idempotent CREATE OR REPLACE; no table
-- rewrite. SECURITY DEFINER + search_path = '' (fully-qualified) per the
-- SECURITY DEFINER rule (v215 used the public,pg_catalog form; this is the
-- stricter correct shape). EXECUTE revoked from PUBLIC/anon/authenticated.
--
-- Three changes:
--   1. list_clone_alerts_pending_netcraft_issue — REWRITE. Now uuid-atomic
--      (GROUP BY submission uuid, LIMIT by uuid not by alert) so a batch can
--      never be split across runs (which would file two issues on one uuid),
--      and DRAIN-AWARE (excludes alerts already filed / terminally skipped /
--      failed / attempt-exhausted / awaiting recheck). Default window widened
--      14→30d: the review empirically found submissions are still readable +
--      escalatable at 24.5 days (is_archived=0), so the old 14d window silently
--      hid ~91% of the filable backlog. is_archived (checked per-fetch in the
--      fn) remains the authoritative skip.
--   2. bump_clone_alert_netcraft_issue_attempt — NEW. Atomic read-modify-write
--      increment of netcraft_issue.attempts (merge_clone_alert_submission
--      REPLACES the whole key, so it can't increment). At attempts>=3 it also
--      stamps failed=true → the worklist drains it (dead-letter for a uuid
--      Netcraft keeps transiently rejecting).
--   3. merge_clone_alert_submission_bulk — NEW. Stamps one jsonb value onto a
--      whole uuid's alert set in ONE statement (atomic; replaces the per-alert
--      loop that could half-stamp on failure and re-file next run).

-- ── 1. Rewritten worklist (return shape changes → DROP then CREATE) ──────────
DROP FUNCTION IF EXISTS public.list_clone_alerts_pending_netcraft_issue(integer, integer);

CREATE FUNCTION public.list_clone_alerts_pending_netcraft_issue(
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
        'target_brand_normalized', sca.target_brand_normalized
      ) AS alert
    FROM public.shopfront_clone_alerts sca
    WHERE sca.submitted_to ? 'netcraft'
      AND sca.submitted_to -> 'netcraft' ->> 'uuid' IS NOT NULL
      AND sca.inferred_target_domain IS NOT NULL
      AND COALESCE(sca.triage_status, '') <> 'fp'
      AND lower(sca.inferred_target_domain) NOT IN
        ('domain.com.au', 'allhomes.com.au', 'lendi.com.au')
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

-- ── 2. Atomic attempt bumper (dead-letter after 3 transient failures) ────────
CREATE OR REPLACE FUNCTION public.bump_clone_alert_netcraft_issue_attempt(
  p_alert_id bigint,
  p_status integer,
  p_error text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cur jsonb;
  v_att integer;
BEGIN
  SELECT submitted_to -> 'netcraft_issue' INTO v_cur
  FROM public.shopfront_clone_alerts WHERE id = p_alert_id;

  v_att := COALESCE((v_cur ->> 'attempts')::int, 0) + 1;

  UPDATE public.shopfront_clone_alerts
  SET submitted_to = pg_catalog.jsonb_set(
        COALESCE(submitted_to, '{}'::jsonb),
        '{netcraft_issue}',
        pg_catalog.jsonb_build_object(
          'attempts', v_att,
          'last_status', p_status,
          'last_error', left(COALESCE(p_error, ''), 300),
          'at', pg_catalog.now()
        ) || CASE WHEN v_att >= 3
                  THEN pg_catalog.jsonb_build_object('failed', true)
                  ELSE '{}'::jsonb END,
        true
      ),
      updated_at = pg_catalog.now()
  WHERE id = p_alert_id;

  RETURN v_att;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bump_clone_alert_netcraft_issue_attempt(bigint, integer, text)
  FROM PUBLIC, anon, authenticated;

-- ── 3. Atomic bulk stamp (one value onto a whole uuid's alert set) ───────────
CREATE OR REPLACE FUNCTION public.merge_clone_alert_submission_bulk(
  p_alert_ids bigint[],
  p_key text,
  p_value jsonb
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH upd AS (
    UPDATE public.shopfront_clone_alerts
    SET submitted_to = pg_catalog.jsonb_set(
          COALESCE(submitted_to, '{}'::jsonb), ARRAY[p_key], p_value, true
        ),
        updated_at = pg_catalog.now()
    WHERE id = ANY(p_alert_ids)
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE EXECUTE ON FUNCTION public.merge_clone_alert_submission_bulk(bigint[], text, jsonb)
  FROM PUBLIC, anon, authenticated;
