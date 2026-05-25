-- v149: Extend the urlscan rescan window from 30 days to 60 days.
--
-- Some attackers season typosquats for 30+ days before activating the
-- phishing payload. A 30-day cap meant any registrant who waited that
-- long would slip past our rescan pipeline. Bump to 60 days as a
-- compromise between operational cost (rescan budget) and detection
-- coverage. Fixes ultrareview F22.
--
-- urlscan free tier headroom: at 60-day window, max stale pool ≈ 60 ×
-- 7 daily candidates × 0.8 still-pending = ~336 rows. Rescan batch
-- limit stays 50/day, so a fully-loaded pool clears every ~7 days.
-- Within free-tier budget (100/day).

CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_urlscan_rescan(
  p_limit int DEFAULT 50,
  p_stale_after_hours int DEFAULT 24
)
RETURNS TABLE (
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  previous_classification text,
  last_scanned_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.urlscan_classification AS previous_classification,
    sca.urlscan_scanned_at AS last_scanned_at
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.triage_status IN ('pending', 'needs_investigation')
    AND sca.urlscan_scanned_at IS NOT NULL
    AND sca.urlscan_scanned_at < now() - (
      GREATEST(1, LEAST(p_stale_after_hours, 168)) * interval '1 hour'
    )
    -- Bumped from 30 → 60 days per ultrareview F22 to cover slow-burn
    -- seasoning attackers (parked for 30+ days before activation).
    AND sca.first_seen_at >= now() - interval '60 days'
  ORDER BY sca.urlscan_scanned_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_urlscan_rescan(int, int)
  FROM anon, authenticated;
