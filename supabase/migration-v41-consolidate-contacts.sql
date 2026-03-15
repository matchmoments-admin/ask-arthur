-- migration-v41-consolidate-contacts.sql
-- Consolidate legacy scam_contacts/scam_contact_reports into scam_entities/report_entity_links,
-- then drop superseded tables (scam_contacts, scam_contact_reports, scam_url_reports, waitlist)
-- and orphaned RPCs (upsert_scam_contact, report_phone_number).

BEGIN;

-- ============================================================================
-- 1a. Migrate scam_contacts → scam_entities (11 rows)
-- ============================================================================
-- For contacts already in scam_entities (matched by entity_type + normalized_value),
-- merge Twilio enrichment data and reconcile timestamps/counts.
-- For contacts NOT yet in scam_entities, insert new rows.
-- We do NOT set canonical_entity_table = 'scam_contacts' since we're about to
-- drop that table — the enrichment data is copied into enrichment_data JSONB.

-- Update existing entities: merge Twilio enrichment from scam_contacts
UPDATE scam_entities e
SET
  enrichment_data = e.enrichment_data || jsonb_strip_nulls(jsonb_build_object(
    'twilio_carrier', sc.current_carrier,
    'twilio_line_type', sc.line_type,
    'twilio_is_voip', sc.is_voip,
    'twilio_country_code', sc.country_code
  )),
  enrichment_status = CASE
    WHEN sc.line_type IS NOT NULL OR sc.current_carrier IS NOT NULL OR sc.country_code IS NOT NULL
    THEN 'completed'
    ELSE e.enrichment_status
  END,
  report_count = GREATEST(e.report_count, sc.report_count),
  first_seen = LEAST(e.first_seen, sc.first_reported_at),
  last_seen = GREATEST(e.last_seen, sc.last_reported_at)
FROM scam_contacts sc
WHERE e.entity_type = sc.contact_type
  AND e.normalized_value = sc.normalized_value;

-- Insert contacts that don't yet exist in scam_entities (expect ~1 row: NZ phone)
INSERT INTO scam_entities (
  entity_type, normalized_value,
  enrichment_data, enrichment_status, report_count, first_seen, last_seen
)
SELECT
  sc.contact_type,
  sc.normalized_value,
  jsonb_strip_nulls(jsonb_build_object(
    'twilio_carrier', sc.current_carrier,
    'twilio_line_type', sc.line_type,
    'twilio_is_voip', sc.is_voip,
    'twilio_country_code', sc.country_code
  )),
  CASE
    WHEN sc.line_type IS NOT NULL OR sc.current_carrier IS NOT NULL OR sc.country_code IS NOT NULL
    THEN 'completed'
    ELSE 'none'
  END,
  sc.report_count,
  sc.first_reported_at,
  sc.last_reported_at
FROM scam_contacts sc
WHERE NOT EXISTS (
  SELECT 1 FROM scam_entities e
  WHERE e.entity_type = sc.contact_type
    AND e.normalized_value = sc.normalized_value
);

-- ============================================================================
-- 1b. Migrate scam_contact_reports → report_entity_links (12 rows)
-- ============================================================================
-- For each contact report, find the corresponding scam_entities row and the
-- closest scam_reports row by reporter_hash + reported_at proximity.
-- Skip if no matching scam_reports row found (no orphan links).

INSERT INTO report_entity_links (report_id, entity_id, extraction_method, role)
SELECT DISTINCT ON (scr.id)
  sr.id AS report_id,
  se.id AS entity_id,
  'manual' AS extraction_method,
  'sender' AS role
FROM scam_contact_reports scr
JOIN scam_contacts sc ON sc.id = scr.scam_contact_id
JOIN scam_entities se ON se.entity_type = sc.contact_type
                     AND se.normalized_value = sc.normalized_value
JOIN scam_reports sr ON sr.reporter_hash = scr.reporter_hash
ORDER BY scr.id, ABS(EXTRACT(EPOCH FROM (sr.created_at - scr.reported_at)))
ON CONFLICT (report_id, entity_id, role) DO NOTHING;

-- ============================================================================
-- 1c. Update canonical_entity_table CHECK constraint
-- ============================================================================
-- Remove 'scam_contacts' from allowed values since we're dropping that table.

ALTER TABLE scam_entities DROP CONSTRAINT IF EXISTS scam_entities_canonical_entity_table_check;
ALTER TABLE scam_entities ADD CONSTRAINT scam_entities_canonical_entity_table_check
  CHECK (canonical_entity_table IS NULL OR canonical_entity_table = ANY (ARRAY[
    'scam_urls'::text, 'scam_ips'::text, 'scam_crypto_wallets'::text
  ]));

-- ============================================================================
-- 1d. Drop superseded tables
-- ============================================================================
-- CASCADE handles FK dependencies automatically.
-- scam_contact_reports (12 rows) → data migrated to report_entity_links above
-- scam_contacts (11 rows) → data migrated to scam_entities above
-- scam_url_reports (0 rows) → fully superseded by report_entity_links (v21)
-- waitlist (0 rows) → unused

DROP TABLE IF EXISTS scam_contact_reports CASCADE;
DROP TABLE IF EXISTS scam_contacts CASCADE;
DROP TABLE IF EXISTS scam_url_reports CASCADE;
DROP TABLE IF EXISTS waitlist CASCADE;

-- ============================================================================
-- 1e. Drop orphaned RPCs
-- ============================================================================
-- upsert_scam_contact only wrote to scam_contacts (now dropped).
-- report_phone_number only wrote to phone_reputation (RPC unused by codebase).

DROP FUNCTION IF EXISTS upsert_scam_contact(text, text, text, text, text, text, text, bigint);
DROP FUNCTION IF EXISTS report_phone_number(text, text, text, text, text);

COMMIT;
