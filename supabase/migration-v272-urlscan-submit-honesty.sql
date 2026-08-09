-- v272 — stop a FAILED urlscan submit from marking a row as submitted.
--
-- Measured in prod 2026-08-09 on the July clone-watch cohort: 162 alerts have
-- `urlscan_submitted_at` set and `urlscan_scanned_at` NULL, permanently. They
-- are not slow — they are unreachable.
--
-- The mechanism is v224's own bug shape, still open in a second place. On a
-- submit failure `urlscan-submit-one.ts` calls this function with
-- p_urlscan_uuid => NULL, and the function stamped `urlscan_submitted_at =
-- now()` UNCONDITIONALLY:
--
--     SET urlscan_uuid = COALESCE(p_urlscan_uuid, sca.urlscan_uuid),
--         urlscan_submitted_at = now(),          -- <— even with a NULL uuid
--
-- The retrieve worklist (list_clone_alerts_pending_urlscan_retrieve) gates on
-- `urlscan_uuid IS NOT NULL`, so such a row is invisible to retrieve forever;
-- after three failures the streak also hides it from submit. It then sits
-- looking "in flight" indefinitely. The rule this repo already wrote down after
-- v224 — a write path must move the row across the exact predicate the next
-- stage filters on, or leave it alone — was not applied to the failure branch.
--
-- Two consequences beyond the stuck rows:
--   * `urlscan_submitted_at IS NOT NULL` is used elsewhere as a proxy for "we
--     submitted this", so it over-counted by the number of failed submits.
--   * The report card's dwell-time metric requires both timestamps, so it
--     silently EXCLUDED these rows rather than flagging them.
--
-- Fix: only stamp the timestamp when a uuid actually came back. The failure
-- branch still bumps the streak (that part was right) and still records
-- evidence; it just no longer claims a submission happened.
--
-- Idempotent: CREATE OR REPLACE of one function, no data migration. Reverting
-- means re-applying v224's body.

CREATE OR REPLACE FUNCTION public.record_clone_alert_urlscan_submit(
  p_alert_id bigint,
  p_urlscan_uuid text,
  p_evidence jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.shopfront_clone_alerts sca
  SET urlscan_uuid = COALESCE(p_urlscan_uuid, sca.urlscan_uuid),
      -- Only a real submission sets the clock. A NULL uuid means the POST
      -- failed, so the row was never handed to urlscan and must not read as
      -- in-flight to anything downstream.
      urlscan_submitted_at = CASE
        WHEN p_urlscan_uuid IS NULL THEN sca.urlscan_submitted_at
        ELSE now()
      END,
      urlscan_evidence = COALESCE(p_evidence, sca.urlscan_evidence),
      urlscan_failure_streak = CASE
        WHEN p_urlscan_uuid IS NULL THEN sca.urlscan_failure_streak + 1
        ELSE 0  -- successful submit → clear stale failures (v224)
      END
  WHERE sca.id = p_alert_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_clone_alert_urlscan_submit(bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.record_clone_alert_urlscan_submit(bigint, text, jsonb) IS
  'Record a urlscan submit attempt. Stamps urlscan_submitted_at ONLY on success '
  '(v272): a NULL uuid means the POST failed, and stamping it stranded the row '
  'outside the retrieve worklist, which gates on urlscan_uuid IS NOT NULL. '
  'Bumps urlscan_failure_streak on failure, resets it on success (v224).';

-- Operator visibility for the cohort this class of bug creates. Nothing in the
-- codebase read urlscan_failure_streak before this — it appeared in zero admin
-- pages, digests and logs, so every previous occurrence was found by a human
-- querying prod by hand.
CREATE OR REPLACE FUNCTION public.clone_watch_urlscan_stranded_count(
  p_max_failure_streak integer DEFAULT 3
)
RETURNS TABLE (
  stranded_streak bigint,
  stranded_submitted_no_uuid bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    -- Excluded from both worklists by the streak cutoff and never classified.
    count(*) FILTER (
      WHERE sca.urlscan_failure_streak >= p_max_failure_streak
        AND sca.urlscan_classification IS NULL
    ),
    -- The v272 shape: looks in-flight, invisible to retrieve.
    count(*) FILTER (
      WHERE sca.urlscan_submitted_at IS NOT NULL
        AND sca.urlscan_uuid IS NULL
        AND sca.urlscan_scanned_at IS NULL
    )
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd';
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.clone_watch_urlscan_stranded_count(integer) IS
  'Counts clone-watch alerts that can never be urlscan-classified: frozen at '
  'the failure-streak cutoff, or stamped submitted with no uuid (pre-v272). '
  'Surfaced on /admin/clone-watch so this cohort is reported rather than '
  'hand-measured.';
