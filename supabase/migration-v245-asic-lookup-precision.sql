-- v245 — tighten lookup_asic_investor_alert precision (PR-A2 follow-up)
--
-- WHY: smoke-testing against the freshly-populated registry (4,181 real ASIC
-- entities, 2026-07-21) surfaced two false-positive classes in v244's lookup,
-- invisible while the table was empty:
--
--  1. name_partial (`entity_name_normalized LIKE '%'||v_q_norm||'%'`, len ≥ 5):
--     a bare common word matched hundreds of entities — 'capital' → 436 hits,
--     'trading' → 181, 'bitcoin' → 15. It only ever fires when the WHOLE query
--     normalizes to a substring of an entity name, i.e. single-word inputs —
--     so it has ZERO true-positive value for real analyze text (a full message
--     never matches) and is pure FP. REMOVED.
--
--  2. domain match used unbounded `position(d IN v_q_low)`, so a short stored
--     domain substring-matched a LEGITIMATE domain — e.g. a listed 'toro.com'
--     would flag 'etoro.com', 'gam.com' would flag 'fx-gam.com'. Now bounded to
--     a real hostname boundary: the stored domain must appear preceded by a
--     non-[a-z0-9-] char (start / '/' / space / subdomain '.') and followed by a
--     non-[a-z0-9.-] char (end / '/' / space) — so `www.`/subdomains still
--     match but glued substrings and TLD-extensions ('example.com.au') do not.
--
-- Same signature + RETURNS TABLE + grants as v244 (CREATE OR REPLACE). SECURITY
-- INVOKER; relies on the public-read-active-rows RLS policy.

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
  WHERE
    a.entity_name_normalized = v_q_norm
    OR v_q_norm = ANY (a.aliases)
    OR EXISTS (
      SELECT 1 FROM unnest(a.domains) d
      WHERE d <> ''
        AND v_q_low ~ ('(^|[^a-z0-9-])' || replace(d, '.', '[.]') || '($|[^a-z0-9.-])')
    )
  ORDER BY a.is_active DESC, a.entity_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_asic_investor_alert(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.lookup_asic_investor_alert(text) IS
  'Is this name/domain ASIC-listed? High-precision: exact name / exact alias / hostname-bounded domain match (no loose name-substring; no glued-domain substring). SECURITY INVOKER over the public-read-active-rows policy. v245 tightened v244 after real-data smoke test. PR-A2 helper: packages/scam-engine/src/asic-lookup.ts.';
