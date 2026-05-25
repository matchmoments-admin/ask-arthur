-- v148: Clone-watch — urlscan.io auto-scan evidence + classification
--
-- Phase A.3 of the measurement closure plan. Auto-scans every new NRD
-- candidate via urlscan.io's free tier and stores the result + a
-- conservative classification. Lets the operator skim screenshots
-- inline in /admin/clone-watch instead of opening urlscan.io tab per
-- row. See docs/plans/clone-watch-outreach.md §15 Phase A.3.

-- 1. Per-alert urlscan evidence + classification columns. All optional;
--    rows without a scan stay NULL.
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS urlscan_evidence jsonb,
  ADD COLUMN IF NOT EXISTS urlscan_classification text
    CHECK (urlscan_classification IS NULL OR urlscan_classification IN (
      'parked_for_sale',     -- effective URL points at Afternic / Sedo / Dan.com — registrant is squatting/selling
      'unresolved',          -- scan didn't render (NXDOMAIN / timeout / HTTP error)
      'likely_phishing',     -- urlscan verdicts.malicious = true OR brand-keyword signal in HTML
      'neutral'              -- resolves to something but no auto-classification — human review
    )),
  ADD COLUMN IF NOT EXISTS urlscan_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS urlscan_uuid text;

-- Partial index for the re-scan cron (find rows due for re-scan).
CREATE INDEX IF NOT EXISTS idx_clone_alerts_urlscan_rescan
  ON public.shopfront_clone_alerts (urlscan_scanned_at NULLS FIRST)
  WHERE source = 'nrd'
    AND triage_status IN ('pending', 'needs_investigation');

-- 2. Selector for the auto-scan path — pulls newly-ingested rows that
--    haven't been scanned yet. Called by the per-event handler when
--    a new clone alert lands.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan(p_limit int DEFAULT 20)
RETURNS TABLE (
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  first_seen_at timestamptz
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
    sca.first_seen_at
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.urlscan_scanned_at IS NULL
    -- Only scan recent rows — anything older than 14 days has aged out
    -- of operational relevance (matcher already triaged or stale).
    AND sca.first_seen_at >= now() - interval '14 days'
  ORDER BY sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan(int)
  FROM anon, authenticated;

-- 2b. Extend the existing list_clone_alerts_pending_triage to also return
--     urlscan classification + screenshot URL + scan timestamp so the
--     admin dashboard can render the new chips + thumbnail without a
--     second roundtrip per row.
--     CREATE OR REPLACE can't change return type — drop + recreate.
DROP FUNCTION IF EXISTS public.list_clone_alerts_pending_triage(int);
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_triage(p_limit int DEFAULT 100)
RETURNS TABLE (
  id bigint,
  inferred_target_domain text,
  candidate_domain text,
  candidate_url text,
  signals jsonb,
  severity_tier text,
  triage_status text,
  first_seen_at timestamptz,
  urlscan_classification text,
  urlscan_scanned_at timestamptz,
  urlscan_screenshot_url text,
  urlscan_effective_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    sca.id,
    sca.inferred_target_domain,
    sca.candidate_domain,
    sca.candidate_url,
    sca.signals,
    sca.severity_tier,
    sca.triage_status,
    sca.first_seen_at,
    sca.urlscan_classification,
    sca.urlscan_scanned_at,
    (sca.urlscan_evidence->>'screenshot_url')::text AS urlscan_screenshot_url,
    (sca.urlscan_evidence->>'effective_url')::text AS urlscan_effective_url
  FROM public.shopfront_clone_alerts sca
  WHERE sca.triage_status = 'pending'
    AND sca.source = 'nrd'
  ORDER BY sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_triage(int)
  FROM anon, authenticated;

-- 3. Selector for the re-scan cron — finds rows whose previous scan is
--    stale and could have transitioned (parked → phishing activation,
--    unresolved → newly-resolving, etc).
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
    -- Only re-scan rows in states where the verdict could plausibly change.
    -- tp_confirmed + tp_actioned stay as-is (operator decided; downstream
    -- consumers acted). fp also stays — no need to spend scan budget on
    -- confirmed false positives.
    AND sca.triage_status IN ('pending', 'needs_investigation')
    AND sca.urlscan_scanned_at IS NOT NULL
    AND sca.urlscan_scanned_at < now() - (
      GREATEST(1, LEAST(p_stale_after_hours, 168)) * interval '1 hour'
    )
    -- Stop re-scanning after 30 days — registrant has either activated
    -- by now or won't. Re-scan budget is finite.
    AND sca.first_seen_at >= now() - interval '30 days'
  ORDER BY sca.urlscan_scanned_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_urlscan_rescan(int, int)
  FROM anon, authenticated;

-- 4. Persist scan result + classification + optional triage transition
--    in one atomic RPC. Re-uses the existing submitted_to merge pattern
--    but writes to top-level columns instead of JSONB.
CREATE OR REPLACE FUNCTION public.persist_clone_alert_urlscan(
  p_alert_id bigint,
  p_urlscan_uuid text,
  p_urlscan_evidence jsonb,
  p_classification text,
  p_set_triage_status text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  urlscan_classification text,
  triage_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_classification IS NOT NULL
     AND p_classification NOT IN ('parked_for_sale','unresolved','likely_phishing','neutral') THEN
    RAISE EXCEPTION 'invalid urlscan classification: %', p_classification
      USING ERRCODE = '22023';
  END IF;
  IF p_set_triage_status IS NOT NULL
     AND p_set_triage_status NOT IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned') THEN
    RAISE EXCEPTION 'invalid triage status: %', p_set_triage_status USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.shopfront_clone_alerts sca
  SET urlscan_uuid = COALESCE(p_urlscan_uuid, sca.urlscan_uuid),
      urlscan_evidence = COALESCE(p_urlscan_evidence, sca.urlscan_evidence),
      urlscan_classification = COALESCE(p_classification, sca.urlscan_classification),
      urlscan_scanned_at = now(),
      -- Never demote: if a row is already tp_confirmed/tp_actioned/fp,
      -- the operator has decided — don't let auto-classify revert it.
      -- Only apply the suggested transition when the row is still pending
      -- or needs_investigation.
      triage_status = CASE
        WHEN sca.triage_status IN ('tp_confirmed','tp_actioned','fp')
          THEN sca.triage_status
        WHEN p_set_triage_status IS NULL
          THEN sca.triage_status
        ELSE p_set_triage_status
      END
  WHERE sca.id = p_alert_id
  RETURNING sca.id, sca.urlscan_classification, sca.triage_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.persist_clone_alert_urlscan(bigint, text, jsonb, text, text) IS
  'Persist urlscan.io scan result + auto-classification. Never demotes a row that the operator has already triaged (tp_confirmed/tp_actioned/fp).';
