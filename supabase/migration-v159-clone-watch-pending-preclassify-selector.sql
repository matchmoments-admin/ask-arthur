-- v159: dedicated pending-preclassify selector for the Haiku classifier
-- fan-out (PR-I, #509).
--
-- Why: the daily NRD ingest (packages/scam-engine/src/inngest/
-- shopfront-nrd-daily-ingest.ts) previously fanned out
-- shopfront/clone.preclassify-requested.v1 events by REUSING the urlscan
-- selector list_clone_alerts_pending_urlscan, whose WHERE clause filters
-- `urlscan_scanned_at IS NULL` (v148). urlscan and the classifier run as
-- independent workers, so the moment urlscan stamps urlscan_scanned_at the
-- row vanished from the selector — any candidate urlscanned-but-not-yet-
-- classified (flag-off window, prior fan-out error, or pushed past the
-- LIMIT 20 cap) was PERMANENTLY excluded from classification, then aged
-- out at 14 days. Confirmed by local-ultrareview F4.
--
-- This selector keys on CLASSIFICATION ABSENCE (LEFT JOIN
-- clone_watch_classifications ... WHERE cwc.alert_id IS NULL) instead of
-- urlscan state, decoupling preclassify coverage from urlscan timing
-- entirely. It also returns inferred_target_domain directly, so the
-- fan-out no longer needs a brand-hydration follow-up SELECT.
--
-- Cost guard: the LIMIT is load-bearing. At ~$0.0024/classification, a
-- 14-day unclassified backlog with no cap could fan out hundreds of events
-- in one ingest run. The hard cap of 100 keeps a single run ≤ ~$0.24; the
-- shared shopfront_clone_outreach $5/day brake is only a backstop. Do NOT
-- raise the cap above 100 without re-running the cost math.
--
-- Additive + idempotent (CREATE OR REPLACE); no reverse script needed.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_preclassify(
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  inferred_target_domain text,
  candidate_domain text,
  candidate_url text
)
LANGUAGE sql
SECURITY DEFINER
-- public, pg_catalog matches the v148/v158 sibling selectors; every
-- reference below is schema-qualified so no unqualified-name exposure.
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    sca.id,
    sca.inferred_target_domain,
    sca.candidate_domain,
    sca.candidate_url
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  WHERE sca.source = 'nrd'
    AND cwc.alert_id IS NULL                            -- not yet classified
    AND sca.inferred_target_domain IS NOT NULL          -- need a brand for the classifier
    AND sca.first_seen_at >= now() - interval '14 days' -- don't reclassify ancient backlog
  ORDER BY sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));               -- HARD CAP — load-bearing cost guard
$$;

-- PUBLIC included per the Supabase auto-grant gotcha: CREATE OR REPLACE
-- FUNCTION auto-grants EXECUTE to PUBLIC, and REVOKE FROM anon,authenticated
-- alone leaves that grant intact (anon inherits via PUBLIC).
REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_preclassify(int)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_pending_preclassify(int) IS
  'Classification-absence selector for the Haiku pre-classifier fan-out. Decouples preclassify coverage from urlscan timing (fixes F4, #509). LIMIT is a hard cost cap (≤100). PR-I (#509).';

COMMIT;
