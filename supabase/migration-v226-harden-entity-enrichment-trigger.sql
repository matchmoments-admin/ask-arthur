-- Migration v226: harden trigger_entity_enrichment_pending search_path
-- (fleet-review D2 follow-up — 2026-07-13).
--
-- v225 recreated trigger_entity_enrichment_pending() (lowering the threshold to
-- report_count >= 2). The get_advisors check after applying v225 flagged
-- `function_search_path_mutable` (WARN) on it — a mutable search_path the
-- original v23 definition also carried. Set an empty search_path to clear it.
-- Safe because the body references only NEW/OLD record fields + a string
-- literal — there is no schema-qualified name to resolve, so `''` cannot break
-- it (SECURITY INVOKER, no extension operators).
--
-- Per supabase/CLAUDE.md rule #1 (never edit a merged migration), this ships as
-- a new forward migration rather than an edit to v225.

CREATE OR REPLACE FUNCTION trigger_entity_enrichment_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.report_count >= 2 AND OLD.report_count < 2 AND OLD.enrichment_status = 'none' THEN
    NEW.enrichment_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;
