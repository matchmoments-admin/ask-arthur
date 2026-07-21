-- v246 — lookup_asic_investor_alert: active-only gate + regex-injection guard
--        (ultracode workstream review follow-ups)
--
-- Two hardening changes on top of v245:
--
-- 1. is_active gate. The RPC is SECURITY INVOKER but is called by the app via
--    the service client (RLS-bypassing), so it saw delisted (is_active=false)
--    rows and could cite an entity ASIC has REMOVED from its list. Gate the
--    whole match on a.is_active so a delisted-only match yields no citation.
--    (is_active stays in the output for observability.)
--
-- 2. Domain-shape guard before the regex. The domain match interpolates the
--    stored domain into a POSIX regex (escaping only '.'). Normalised domains
--    are [a-z0-9.-] so this is safe today, but a malformed value would inject a
--    metacharacter — at worst erroring the query (caught by checkAsicListed's
--    never-throws) or over-matching. Require d ~ '^[a-z0-9.-]+$' before it ever
--    reaches the regex, so a non-conforming domain is skipped, not interpolated.
--
-- (The shared-platform deny-list itself lives at ingest — asic_investor_alerts.py
-- SHARED_PLATFORM_DOMAINS, #843 — the single source of truth. This migration is
-- the lookup-side correctness + safety net.)
--
-- CREATE OR REPLACE, same signature + grants as v244/v245.

CREATE OR REPLACE FUNCTION public.lookup_asic_investor_alert(p_query text)
RETURNS TABLE (
  id          bigint,
  entity_name text,
  alert_type  text,
  asic_url    text,
  domains     text[],
  match_type  text,
  is_active   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_q_norm text := public.brand_normalize(COALESCE(p_query, ''));
  v_q_low  text := lower(COALESCE(p_query, ''));
BEGIN
  IF v_q_norm IS NULL OR length(v_q_norm) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.entity_name,
    a.alert_type,
    a.asic_url,
    a.domains,
    CASE
      WHEN a.entity_name_normalized = v_q_norm THEN 'name'
      WHEN v_q_norm = ANY (a.aliases) THEN 'alias'
      ELSE 'domain'
    END AS match_type,
    a.is_active
  FROM public.asic_investor_alerts a
  WHERE a.is_active
    AND (
      a.entity_name_normalized = v_q_norm
      OR v_q_norm = ANY (a.aliases)
      OR EXISTS (
        SELECT 1 FROM unnest(a.domains) d
        WHERE d <> ''
          AND d ~ '^[a-z0-9.-]+$'
          AND v_q_low ~ ('(^|[^a-z0-9-])' || replace(d, '.', '[.]') || '($|[^a-z0-9.-])')
      )
    )
  ORDER BY a.entity_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_asic_investor_alert(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.lookup_asic_investor_alert(text) IS
  'Is this name/domain ASIC-listed? Active rows only; exact name / exact alias / hostname-bounded domain match with a domain-shape guard against regex injection. SECURITY INVOKER over the public-read-active-rows policy. v246 hardened v245. Shared-platform deny-list is at ingest (asic_investor_alerts.py). PR-A2 helper: packages/scam-engine/src/asic-lookup.ts.';