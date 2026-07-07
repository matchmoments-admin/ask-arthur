-- v203 — masked brand-exposure teaser RPC
--        (Wave 2 PR 2.1 of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: the self-serve "Is your brand being cloned?" checker is the Clone Watch
-- funnel destination — a brand enters its name/domain and sees how many
-- lookalikes we've detected, then gates the full list behind a work-email lead.
-- The teaser MUST be scrape-proof: it can only ever reveal a brand's OWN
-- adjudicated lookalikes, masked, capped — never dump the table.
--
-- Three anti-scrape layers, of which this RPC is the innermost:
--   1. (caller) EXACT brand resolution via resolveWatchlistBrand — arbitrary
--      input ("%%", "a%") resolves to nothing, so it can't widen scope.
--   2. (this RPC) equality match on target_brand_normalized (NOT ilike/like),
--      adjudicated rows only (tp_confirmed/tp_actioned), MASKED domains, ≤5
--      examples. '%' as input matches literally nothing.
--   3. (caller) work-email gate + IP rate-limit before the full unmasked list.
--
-- SECURITY DEFINER + service_role only — the /api/brand-exposure route calls it
-- server-side; anon never reaches it directly. Idempotent.

CREATE OR REPLACE FUNCTION public.brand_exposure_summary(
  p_brand_normalized text
)
RETURNS TABLE (
  detected_count int,
  earliest timestamptz,
  examples jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  WITH hits AS (
    SELECT candidate_domain, first_seen_at, urlscan_classification
    FROM public.shopfront_clone_alerts
    WHERE target_brand_normalized = p_brand_normalized   -- EXACT equality, never LIKE
      AND source = 'nrd'
      AND triage_status IN ('tp_confirmed', 'tp_actioned') -- adjudicated only
  )
  SELECT
    (SELECT count(*)::int FROM hits),
    (SELECT min(first_seen_at) FROM hits),
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          -- mask: first char + *** + last char of the primary label, then TLD
          'masked',
          left(split_part(e.candidate_domain, '.', 1), 1)
            || repeat('*', 3)
            || right(split_part(e.candidate_domain, '.', 1), 1)
            || '.'
            || split_part(e.candidate_domain, '.', 2),
          'classification', e.urlscan_classification,
          'first_seen', to_char(e.first_seen_at, 'YYYY-MM-DD')
        ))
        FROM (
          SELECT candidate_domain, first_seen_at, urlscan_classification
          FROM hits
          ORDER BY first_seen_at DESC
          LIMIT 5
        ) e
      ),
      '[]'::jsonb
    );
$$;

-- Callable only by the server (service_role). NOT anon/authenticated — the
-- public checker route resolves the brand + rate-limits, then calls this.
REVOKE ALL ON FUNCTION public.brand_exposure_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_exposure_summary(text) TO service_role;

COMMENT ON FUNCTION public.brand_exposure_summary(text) IS
  'v203: scrape-proof masked exposure teaser. Equality match on an already-resolved brand key; adjudicated rows only; ≤5 masked examples. service_role only. See docs/plans/clone-watch-enforcement-and-monetisation.md Wave 2.';
