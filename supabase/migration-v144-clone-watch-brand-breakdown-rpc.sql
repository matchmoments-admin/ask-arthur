-- v144: Clone-watch — per-brand aggregation RPCs for measurement closure.
--
-- Powers two new dashboards (admin per-brand table + public 30-day impact).
-- Both RPCs are SECURITY DEFINER, search_path locked, anon/authed revoked.
-- See docs/plans/clone-watch-outreach.md §15 Phase A.

-- 1. Admin per-brand history (called by /admin/clone-watch page).
--    Returns one row per inferred_target_domain with funnel-style counts.
CREATE OR REPLACE FUNCTION public.clone_watch_brand_breakdown(p_days int DEFAULT 30)
RETURNS TABLE (
  brand text,
  total_candidates bigint,
  tp_confirmed bigint,
  tp_actioned bigint,
  fp bigint,
  pending bigint,
  netcraft_submits bigint,
  brand_notifications bigint,
  first_hit_at timestamptz,
  last_hit_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  WITH window_rows AS (
    SELECT *
    FROM public.shopfront_clone_alerts
    WHERE source = 'nrd'
      AND first_seen_at >= now() - (GREATEST(1, LEAST(p_days, 365)) * interval '1 day')
  )
  SELECT
    w.inferred_target_domain AS brand,
    COUNT(*) AS total_candidates,
    COUNT(*) FILTER (WHERE w.triage_status = 'tp_confirmed') AS tp_confirmed,
    COUNT(*) FILTER (WHERE w.triage_status = 'tp_actioned') AS tp_actioned,
    COUNT(*) FILTER (WHERE w.triage_status = 'fp') AS fp,
    COUNT(*) FILTER (WHERE w.triage_status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE w.submitted_to ? 'netcraft') AS netcraft_submits,
    COUNT(*) FILTER (WHERE w.submitted_to ? 'brand_notification') AS brand_notifications,
    MIN(w.first_seen_at) AS first_hit_at,
    MAX(w.first_seen_at) AS last_hit_at
  FROM window_rows w
  GROUP BY w.inferred_target_domain
  ORDER BY total_candidates DESC, last_hit_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_brand_breakdown(int) FROM anon, authenticated;

-- 2. Public-safe aggregate (called by /clone-watch consumer page).
--    Returns aggregate-only — no per-brand attribution, no candidate domains.
--    The shape is intentionally narrower than the admin RPC because this
--    one CAN be hit by anon traffic (gated by FF_SHOPFRONT_CLONE_OUTREACH
--    + a public Server Component fetch; not directly exposed as an API).
CREATE OR REPLACE FUNCTION public.clone_watch_public_impact(p_days int DEFAULT 30)
RETURNS TABLE (
  window_days int,
  candidates_total bigint,
  tp_confirmed_total bigint,
  netcraft_submits_total bigint,
  brand_notifications_total bigint,
  brands_protected bigint,
  computed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  WITH window_rows AS (
    SELECT *
    FROM public.shopfront_clone_alerts
    WHERE source = 'nrd'
      AND first_seen_at >= now() - (GREATEST(1, LEAST(p_days, 90)) * interval '1 day')
  )
  SELECT
    GREATEST(1, LEAST(p_days, 90)) AS window_days,
    COUNT(*) AS candidates_total,
    COUNT(*) FILTER (WHERE triage_status IN ('tp_confirmed','tp_actioned')) AS tp_confirmed_total,
    COUNT(*) FILTER (WHERE submitted_to ? 'netcraft') AS netcraft_submits_total,
    COUNT(*) FILTER (WHERE submitted_to ? 'brand_notification') AS brand_notifications_total,
    COUNT(DISTINCT inferred_target_domain) FILTER (WHERE triage_status IN ('tp_confirmed','tp_actioned')) AS brands_protected,
    now() AS computed_at
  FROM window_rows;
$$;

-- Anon EXECUTE intentionally NOT revoked — this is the one clone-watch
-- RPC that the public /clone-watch page may hit unauthenticated.
-- The output is aggregate-only and cannot be used to enumerate operators.
GRANT EXECUTE ON FUNCTION public.clone_watch_public_impact(int) TO anon, authenticated;

COMMENT ON FUNCTION public.clone_watch_public_impact(int) IS
  'Public-safe aggregate counts for /clone-watch consumer page. Gated by FF_SHOPFRONT_CLONE_OUTREACH at the call site; the RPC itself is anon-callable so SSR works without a service-role client.';
