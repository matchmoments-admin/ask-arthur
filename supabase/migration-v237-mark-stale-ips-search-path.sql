-- migration-v237-mark-stale-ips-search-path.sql
--
-- Defense-in-depth: bring mark_stale_ips (v234) into line with the house
-- SECURITY DEFINER rule (empty search_path + fully-qualified names) that the
-- sibling v235 clone_campaigns_for_brand already follows. v234 used
-- `SET search_path = public, pg_catalog` with an unqualified `UPDATE scam_ips`.
-- Not exploitable today (REVOKEd from PUBLIC/anon/authenticated; callable roles
-- lack CREATE on public), but the empty-path form removes the
-- unqualified-name-resolution attack surface entirely. pg_catalog is still
-- implicitly searched, so now()/json_build_object() resolve without prefixes.
--
-- Idempotent (CREATE OR REPLACE). Signature unchanged (int, int).

CREATE OR REPLACE FUNCTION public.mark_stale_ips(
  p_stale_days INT DEFAULT 7,
  p_limit INT DEFAULT 5000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INT;
BEGIN
  SET LOCAL statement_timeout = '90s';

  UPDATE public.scam_ips
  SET is_active = FALSE,
      staleness_checked_at = now()
  WHERE id IN (
    SELECT id
    FROM public.scam_ips
    WHERE is_active = TRUE
      AND last_seen_in_feed IS NOT NULL
      AND last_seen_in_feed < now() - (p_stale_days || ' days')::INTERVAL
      AND confidence_level NOT IN ('high', 'confirmed')
    ORDER BY id
    LIMIT p_limit
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days,
    'batch_limit', p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_ips(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_ips(INT, INT) TO service_role;
