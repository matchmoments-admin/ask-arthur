-- migration-v73-analyze-idempotency.sql
--
-- Enables idempotent re-submission of analyze pipeline events. The analyze
-- flow moves from the ad-hoc waitUntil fan-out in the route handler to a
-- durable Inngest `analyze.completed.v1` event whose consumers write to
-- scam_reports, verified_scams, brand_alerts, etc. Consumers can retry on
-- transient failures; without this migration, a retried INSERT would create
-- a duplicate scam_reports row.
--
-- Design:
--   1. Add nullable `idempotency_key TEXT` column to scam_reports.
--   2. Partial unique index — enforced only when the key is non-null, so
--      existing rows (which don't have one) don't need backfilling and
--      ad-hoc inserts from other code paths stay unaffected.
--   3. Update `create_scam_report` RPC: new optional `p_idempotency_key`
--      parameter; ON CONFLICT on the idempotency index returns the
--      existing row's id rather than raising. This makes the RPC safe to
--      call twice with the same key — second call is a no-op that returns
--      the original id.
--
-- NOTE on partitioning (v71 scaffold): when the scam_reports cutover to
-- scam_reports_partitioned happens per docs/partitioning-runbook.md, the
-- operator MUST carry the `idempotency_key` column AND this partial unique
-- index across to the partitioned table. On partitioned tables, a unique
-- index must include all partition key columns — the current partition key
-- is `created_at`, so the final form on the partitioned table is
--     CREATE UNIQUE INDEX ... ON scam_reports_partitioned
--       (idempotency_key, created_at) WHERE idempotency_key IS NOT NULL;
-- The migration here uses the single-column form because the current
-- scam_reports is still a heap table.

-- =============================================================================
-- 1. Column + partial unique index
-- =============================================================================

ALTER TABLE scam_reports
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- ULID is 26 chars; give room for Stripe-style custom keys up to 255.
ALTER TABLE scam_reports
  ADD CONSTRAINT scam_reports_idempotency_key_length
  CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scam_reports_idempotency_key
  ON scam_reports (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN scam_reports.idempotency_key IS
  'Client Idempotency-Key header OR auto-generated ULID. Carried through the analyze pipeline as the Inngest event id. Partial unique index permits NULL for legacy/direct inserts.';

-- =============================================================================
-- 2. Updated create_scam_report RPC — idempotent on (idempotency_key)
-- =============================================================================
--
-- The DO UPDATE is a no-op (SET idempotency_key = EXCLUDED.idempotency_key
-- which is identical to the existing value on conflict). This idiom is
-- needed because ON CONFLICT DO NOTHING does not return rows — we want
-- RETURNING id to fire whether we inserted or hit an existing row.

CREATE OR REPLACE FUNCTION create_scam_report(
  p_reporter_hash TEXT,
  p_source TEXT,
  p_input_mode TEXT,
  p_verdict TEXT,
  p_confidence_score REAL,
  p_scam_type TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL,
  p_delivery_method TEXT DEFAULT NULL,
  p_impersonated_brand TEXT DEFAULT NULL,
  p_scrubbed_content TEXT DEFAULT NULL,
  p_analysis_result JSONB DEFAULT '{}',
  p_verified_scam_id BIGINT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO scam_reports (
    reporter_hash, source, input_mode, verdict, confidence_score,
    scam_type, channel, delivery_method, impersonated_brand,
    scrubbed_content, analysis_result, verified_scam_id, region, country_code,
    idempotency_key
  ) VALUES (
    p_reporter_hash, p_source, p_input_mode, p_verdict, p_confidence_score,
    p_scam_type, p_channel, p_delivery_method, p_impersonated_brand,
    p_scrubbed_content, p_analysis_result, p_verified_scam_id, p_region, p_country_code,
    p_idempotency_key
  )
  ON CONFLICT (idempotency_key)
    WHERE idempotency_key IS NOT NULL
    DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION create_scam_report IS
  'Idempotent on idempotency_key (v73). Passing the same key twice returns the original row id without inserting. NULL key preserves legacy non-idempotent behaviour.';
