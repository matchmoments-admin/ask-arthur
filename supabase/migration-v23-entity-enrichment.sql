-- Migration v23: Entity enrichment columns — stores external intelligence data
-- per entity (WHOIS, Twilio, Safe Browsing, etc.). Purely additive to v21.

-- =============================================================================
-- Add enrichment columns to scam_entities
-- =============================================================================
ALTER TABLE scam_entities
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'none'
    CHECK (enrichment_status IN ('none', 'pending', 'in_progress', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS enrichment_data JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_error TEXT;

-- Index for the enrichment worker: find entities needing enrichment
CREATE INDEX IF NOT EXISTS idx_scam_entities_enrichment_pending
  ON scam_entities (enrichment_status, report_count DESC)
  WHERE enrichment_status IN ('pending', 'failed') AND report_count >= 3;

-- =============================================================================
-- Trigger: auto-set enrichment_status to 'pending' when report_count crosses 3
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_entity_enrichment_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.report_count >= 3 AND OLD.report_count < 3 AND OLD.enrichment_status = 'none' THEN
    NEW.enrichment_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_enrichment_pending ON scam_entities;
CREATE TRIGGER trg_entity_enrichment_pending
  BEFORE UPDATE ON scam_entities
  FOR EACH ROW
  EXECUTE FUNCTION trigger_entity_enrichment_pending();
