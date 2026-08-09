-- v275 — the retrieve worklist's age gate hid 193 alerts behind a NULL comparison.
--
-- Measured in prod 2026-08-09: 193 source='nrd' alerts hold a real
-- `urlscan_uuid` with `urlscan_submitted_at` IS NULL and no classification.
-- They are not slow. They are unreachable, by all three lanes at once:
--
--   * RETRIEVE gates on `sca.urlscan_submitted_at <= now() - (p_min_age_minutes
--     * interval '1 minute')`. Against NULL that expression evaluates to NULL,
--     which is not TRUE, so the row is filtered out — silently, and forever.
--     Three-valued logic: `NULL <= anything` is NULL, never false, so it never
--     trips a reviewer reading the clause as a comparison.
--   * SUBMIT gates on `sca.urlscan_uuid IS NULL`. These rows have a uuid.
--   * RECHECK gates on `lifecycle_state IN ('monitoring','declined')`. 190 of the
--     193 are still 'detected'.
--
-- Every one carries `urlscan_scanned_at` (193/193), so a prior
-- persist_clone_alert_urlscan ran and stamped the scan clock while leaving the
-- classification NULL — the legacy retrieval-timeout shape, first_seen
-- 2026-05-24 to 2026-06-08, pre-dating the async rebuild. 106 pass the
-- preclassifier gate. Only 1 has a failure streak at or over the cutoff.
--
-- Fix: COALESCE the age gate onto `urlscan_scanned_at`, which every affected row
-- has. This is a predicate change ONLY — no UPDATE, no backfill, no invented
-- timestamps. Their uuids are real and urlscan retains results for the owning
-- key, so the recovery costs 193 GETs and zero submit quota. Rows whose results
-- have genuinely expired will 404 into the existing not-ready path and age out
-- through the normal streak after three ticks, which is the correct outcome and
-- self-limiting.
--
-- Also adds the `source = 'nrd'` filter both sibling worklists already carry
-- (list_clone_alerts_pending_urlscan_submit and list_clone_alerts_for_recheck
-- both pin it; this one never did). Latent today at 0 non-nrd rows, but the
-- table is the shared home for future clone sources.
--
-- DELIBERATE OMISSION — the plan also called for widening
-- list_clone_alerts_for_recheck to accept `lifecycle_state='detected' AND
-- urlscan_classification IS NULL`, to give the 190 detected rows a lane. Measured
-- before writing it: that would add 699 rows to a 1,562-row pool (+45%), and 535
-- of those (77%) are rows the preclassifier explicitly judged NOT a clone. The
-- recheck lane submits to urlscan, so that is the "don't loosen the 0.7 clone
-- gate" trap arriving through a different door. It is also unnecessary: the
-- COALESCE below already reaches all 193, because all 193 have
-- urlscan_scanned_at. Narrower fix, same recovery, no new waste.
--
-- Idempotent: CREATE OR REPLACE, same signature and return shape as v224.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(
  p_limit integer DEFAULT 30,
  p_min_age_minutes integer DEFAULT 10,
  p_max_failure_streak integer DEFAULT 3
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  urlscan_uuid text,
  urlscan_evidence jsonb
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
    sca.urlscan_uuid,
    sca.urlscan_evidence
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'                    -- v275: both siblings pin this
    AND sca.urlscan_uuid IS NOT NULL
    AND (
      sca.urlscan_classification IS NULL
      -- v224: a rescan submitted since the last successful scan supersedes it.
      OR sca.urlscan_submitted_at > COALESCE(sca.urlscan_scanned_at, 'epoch'::timestamptz)
    )
    AND sca.urlscan_failure_streak < p_max_failure_streak
    -- v275: fall back to the scan clock. An unguarded `urlscan_submitted_at <=`
    -- yields NULL (not false) for a row with a uuid and no submit timestamp, so
    -- 193 alerts were filtered out of this worklist permanently.
    AND COALESCE(sca.urlscan_submitted_at, sca.urlscan_scanned_at)
        <= now() - (p_min_age_minutes * interval '1 minute')
  ORDER BY COALESCE(sca.urlscan_submitted_at, sca.urlscan_scanned_at) ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_clone_alerts_pending_urlscan_retrieve(integer, integer, integer) IS
  'Clone alerts whose urlscan result is ready to fetch. The age gate and the ORDER '
  'BY both COALESCE urlscan_submitted_at onto urlscan_scanned_at (v275): against a '
  'NULL submitted_at the bare comparison yields NULL rather than false, which hid '
  '193 alerts holding a real uuid from this worklist permanently. Pinned to '
  'source=''nrd'' (v275) to match both sibling worklists.';
