-- Migration v36: Reddit feed support
-- Enables Reddit r/Scams scraper to store phone/email IOCs via scam_entities table.
-- Purely additive: constraint relaxation + new RPC function.

-- =============================================================================
-- 1. Relax feed_ingestion_log.record_type to include 'entity'
-- =============================================================================
ALTER TABLE feed_ingestion_log
  DROP CONSTRAINT IF EXISTS feed_ingestion_log_record_type_check;
ALTER TABLE feed_ingestion_log
  ADD CONSTRAINT feed_ingestion_log_record_type_check
    CHECK (record_type IN ('url', 'ip', 'crypto_wallet', 'entity'));

-- =============================================================================
-- 2. Feed-optimized entity upsert (no report_id required)
--    Mirrors bulk_upsert_feed_url() pattern: upsert, bump count, return JSON.
-- =============================================================================
CREATE OR REPLACE FUNCTION bulk_upsert_feed_entity(
  p_entity_type TEXT,
  p_normalized_value TEXT,
  p_feed_source TEXT DEFAULT 'unknown',
  p_feed_reference_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id BIGINT;
  v_is_new BOOLEAN;
BEGIN
  INSERT INTO scam_entities (entity_type, normalized_value, raw_value)
  VALUES (p_entity_type, p_normalized_value, p_normalized_value)
  ON CONFLICT (entity_type, normalized_value) DO UPDATE SET
    report_count = scam_entities.report_count + 1,
    last_seen = NOW()
  RETURNING id, (xmax = 0) INTO v_id, v_is_new;

  RETURN json_build_object('entity_id', v_id, 'is_new', v_is_new);
END;
$$;
