-- migration-v42-data-quality-fixes.sql
-- Backfill scam_entities from high-activity canonical tables,
-- auto-score backfilled entities, and promote URL confidence levels.

BEGIN;

-- ============================================================================
-- 2a. Backfill scam_entities from high-activity URLs (~4,910 rows)
-- ============================================================================
-- Insert active URLs with report_count >= 3 that have no corresponding scam_entities row.

INSERT INTO scam_entities (
  entity_type, normalized_value, canonical_entity_table, canonical_entity_id,
  report_count, first_seen, last_seen, feed_sources, last_seen_in_feed,
  feed_reported_at, feed_references
)
SELECT
  'url',
  u.normalized_url,
  'scam_urls',
  u.id,
  u.report_count,
  COALESCE(u.first_reported_at, u.created_at),
  COALESCE(u.last_reported_at, u.created_at),
  u.feed_sources,
  u.last_seen_in_feed,
  u.feed_reported_at,
  u.feed_references
FROM scam_urls u
WHERE u.is_active = TRUE
  AND u.report_count >= 3
  AND NOT EXISTS (
    SELECT 1 FROM scam_entities e
    WHERE e.canonical_entity_table = 'scam_urls'
      AND e.canonical_entity_id = u.id
  )
ON CONFLICT (entity_type, normalized_value) DO UPDATE SET
  canonical_entity_table = EXCLUDED.canonical_entity_table,
  canonical_entity_id = EXCLUDED.canonical_entity_id,
  report_count = GREATEST(scam_entities.report_count, EXCLUDED.report_count),
  first_seen = LEAST(scam_entities.first_seen, EXCLUDED.first_seen),
  last_seen = GREATEST(scam_entities.last_seen, EXCLUDED.last_seen);

-- ============================================================================
-- 2b. Backfill scam_entities from high-activity IPs (~9,491 rows)
-- ============================================================================
-- Insert active IPs with blocklist_count >= 3 that have no corresponding scam_entities row.

INSERT INTO scam_entities (
  entity_type, normalized_value, canonical_entity_table, canonical_entity_id,
  report_count, first_seen, last_seen, feed_sources, last_seen_in_feed,
  feed_reported_at, feed_references
)
SELECT
  'ip',
  host(i.ip_address),
  'scam_ips',
  i.id,
  i.blocklist_count,
  COALESCE(i.first_seen, i.created_at),
  COALESCE(i.last_online, i.created_at),
  i.feed_sources,
  i.last_seen_in_feed,
  i.feed_reported_at,
  i.feed_references
FROM scam_ips i
WHERE i.is_active = TRUE
  AND i.blocklist_count >= 3
  AND NOT EXISTS (
    SELECT 1 FROM scam_entities e
    WHERE e.canonical_entity_table = 'scam_ips'
      AND e.canonical_entity_id = i.id
  )
ON CONFLICT (entity_type, normalized_value) DO UPDATE SET
  canonical_entity_table = EXCLUDED.canonical_entity_table,
  canonical_entity_id = EXCLUDED.canonical_entity_id,
  report_count = GREATEST(scam_entities.report_count, EXCLUDED.report_count),
  first_seen = LEAST(scam_entities.first_seen, EXCLUDED.first_seen),
  last_seen = GREATEST(scam_entities.last_seen, EXCLUDED.last_seen);

-- ============================================================================
-- 2c. Auto-score backfilled entities
-- ============================================================================
-- Run compute_entity_risk_score on all entities still at UNKNOWN risk level.
-- This uses the existing v27 scoring RPC. We batch via a DO block since the
-- RPC processes one entity at a time.

DO $$
DECLARE
  rec RECORD;
  scored INT := 0;
BEGIN
  FOR rec IN
    SELECT id FROM scam_entities WHERE risk_level = 'UNKNOWN' ORDER BY id
  LOOP
    PERFORM compute_entity_risk_score(rec.id);
    scored := scored + 1;
  END LOOP;
  RAISE NOTICE 'Scored % entities', scored;
END $$;

-- ============================================================================
-- 2d. Promote URL confidence levels
-- ============================================================================
-- Promote low → medium: active with 3+ reports OR 2+ feed sources
UPDATE scam_urls SET confidence_level = 'medium'
WHERE confidence_level = 'low'
  AND is_active = TRUE
  AND (report_count >= 3 OR array_length(feed_sources, 1) >= 2);

-- Promote low/medium → high: active with 5+ reports AND 2+ feed sources
UPDATE scam_urls SET confidence_level = 'high'
WHERE confidence_level IN ('low', 'medium')
  AND is_active = TRUE
  AND report_count >= 5
  AND array_length(feed_sources, 1) >= 2;

COMMIT;
