-- v170: report_scam_entity RPC — single-call write path for the consumer
-- "report this phone/email" surfaces, re-wired onto the unified scam_entities
-- model (the v41 consolidation target, after scam_contacts + upsert_scam_contact
-- were dropped). The existing upsert_scam_entity (v21) returns only
-- {entity_id, is_new} and can't set country_code or return report_count, which
-- the /api/scam-contacts/report UI (components/ScamReportCard.tsx) needs to
-- preserve its response contract.
--
-- This RPC: upserts on (entity_type, normalized_value) — incrementing
-- report_count + bumping last_seen (mirrors upsert_scam_entity's conflict
-- logic), fills country_code (kept if already set), optionally links the entity
-- to an existing scam_report, and RETURNS the resulting report_count. Twilio /
-- email-domain enrichment stays in the route (it's a TS Twilio call) and is
-- layered on via the existing merge_entity_enrichment_data.
--
-- SECURITY DEFINER + search_path = '' (all refs fully-qualified) +
-- #variable_conflict use_column (OUT params shadow table columns) + REVOKE
-- FROM PUBLIC, anon, authenticated (Supabase auto-grants EXECUTE to PUBLIC;
-- per-role revoke alone is a no-op — the v160/#459 lesson). Service-role only:
-- the routes call it via createServiceClient(). Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.report_scam_entity(
  p_entity_type     TEXT,
  p_normalized_value TEXT,
  p_raw_value       TEXT    DEFAULT NULL,
  p_country_code    TEXT    DEFAULT NULL,
  p_report_id       BIGINT  DEFAULT NULL,
  p_role            TEXT    DEFAULT 'sender'
)
RETURNS TABLE (entity_id BIGINT, is_new BOOLEAN, report_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_id    BIGINT;
  v_new   BOOLEAN;
  v_count INT;
BEGIN
  INSERT INTO public.scam_entities (entity_type, normalized_value, raw_value, country_code)
  VALUES (p_entity_type, p_normalized_value, p_raw_value, p_country_code)
  ON CONFLICT (entity_type, normalized_value) DO UPDATE SET
    report_count = public.scam_entities.report_count + 1,
    last_seen    = now(),
    raw_value    = COALESCE(EXCLUDED.raw_value, public.scam_entities.raw_value),
    country_code = COALESCE(public.scam_entities.country_code, EXCLUDED.country_code)
  RETURNING id, (xmax = 0), report_count
  INTO v_id, v_new, v_count;

  -- Link to a report only when the id refers to a real scam_report, so a
  -- stray/foreign analysis id can never raise an FK violation.
  IF p_report_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.scam_reports WHERE id = p_report_id) THEN
    PERFORM public.link_report_entity(p_report_id, v_id, 'manual', p_role);
  END IF;

  entity_id    := v_id;
  is_new       := v_new;
  report_count := v_count;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_scam_entity(text, text, text, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_scam_entity(text, text, text, text, bigint, text)
  TO service_role;

COMMENT ON FUNCTION public.report_scam_entity(text, text, text, text, bigint, text) IS
  'Consumer "report this contact" write path on scam_entities: upsert (entity_type, normalized_value) incrementing report_count, fill country_code, optionally link to a scam_report (only if it exists), return report_count. Replaces the dropped upsert_scam_contact (v41).';
