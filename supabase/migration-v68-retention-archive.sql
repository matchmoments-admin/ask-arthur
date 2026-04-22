-- migration-v68-retention-archive.sql
--
-- Retention strategy for the unbounded scam_reports table. We ARCHIVE rather
-- than delete: cold-table copies hold the rows, the hot table stays lean, and
-- queries that genuinely need history can read the archive.
--
-- Cutoffs (enforced in the companion cron):
--   SAFE, SUSPICIOUS, UNCERTAIN  -> archive after 90 days
--   HIGH_RISK                    -> archive after 180 days
--
-- Why two cutoffs: HIGH_RISK rows are the most operationally valuable (fraud
-- team references, feed de-duplication, cluster re-computation) so they earn
-- a longer hot-table residency. SAFE/SUSPICIOUS rows are mostly telemetry.

-- =============================================================================
-- Archive tables — mirror the source schema exactly, no FKs to hot tables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS scam_reports_archive (
  id              BIGINT PRIMARY KEY,
  reporter_hash   TEXT NOT NULL,
  source          TEXT NOT NULL,
  input_mode      TEXT,
  verdict         TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  scam_type       TEXT,
  channel         TEXT,
  delivery_method TEXT,
  impersonated_brand TEXT,
  scrubbed_content TEXT,
  analysis_result JSONB NOT NULL DEFAULT '{}',
  verified_scam_id BIGINT,
  region          TEXT,
  country_code    TEXT,
  cluster_id      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scam_reports_archive_created
  ON scam_reports_archive (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scam_reports_archive_verdict
  ON scam_reports_archive (verdict);
CREATE INDEX IF NOT EXISTS idx_scam_reports_archive_verified
  ON scam_reports_archive (verified_scam_id);

CREATE TABLE IF NOT EXISTS report_entity_links_archive (
  id                BIGINT PRIMARY KEY,
  report_id         BIGINT NOT NULL,
  entity_id         BIGINT NOT NULL,
  extraction_method TEXT NOT NULL,
  role              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  archived_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rel_archive_report
  ON report_entity_links_archive (report_id);
CREATE INDEX IF NOT EXISTS idx_rel_archive_entity
  ON report_entity_links_archive (entity_id);

CREATE TABLE IF NOT EXISTS cluster_reports_archive (
  id          BIGINT PRIMARY KEY,
  cluster_id  BIGINT NOT NULL,
  report_id   BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cluster_archive_cluster
  ON cluster_reports_archive (cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_archive_report
  ON cluster_reports_archive (report_id);

-- =============================================================================
-- RLS — service-role-only. Archives are not public even though scam_reports is.
-- Exposing archive data through a dedicated view later is a deliberate choice.
-- =============================================================================

ALTER TABLE scam_reports_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_entity_links_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_reports_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages scam_reports_archive"
  ON scam_reports_archive;
CREATE POLICY "Service role manages scam_reports_archive"
  ON scam_reports_archive FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages report_entity_links_archive"
  ON report_entity_links_archive;
CREATE POLICY "Service role manages report_entity_links_archive"
  ON report_entity_links_archive FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages cluster_reports_archive"
  ON cluster_reports_archive;
CREATE POLICY "Service role manages cluster_reports_archive"
  ON cluster_reports_archive FOR ALL
  USING (auth.role() = 'service_role');

-- =============================================================================
-- archive_scam_reports_batch — move a bounded batch of aged rows to archive.
--
-- Called by /api/cron/scam-reports-retention. Bounded batch size keeps the
-- transaction short (long transactions block autovacuum and hurt planner stats
-- on a hot table). The cron re-invokes until the returned moved_count = 0.
-- =============================================================================

CREATE OR REPLACE FUNCTION archive_scam_reports_batch(
  p_batch_size INT DEFAULT 5000,
  p_high_risk_days INT DEFAULT 180,
  p_default_days INT DEFAULT 90
)
RETURNS TABLE (
  moved_reports INT,
  moved_links   INT,
  moved_cluster_links INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids BIGINT[];
  v_moved_reports INT := 0;
  v_moved_links INT := 0;
  v_moved_cluster INT := 0;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'archive_scam_reports_batch is service-role-only';
  END IF;

  -- Pick the eligible ids up-front so the subsequent INSERT/DELETE both
  -- operate on the same fixed set (no phantom-row risk on a busy table).
  SELECT array_agg(id)
    INTO v_ids
    FROM (
      SELECT id
        FROM scam_reports
       WHERE (
               (verdict = 'HIGH_RISK' AND created_at < NOW() - (p_high_risk_days || ' days')::INTERVAL)
            OR (verdict <> 'HIGH_RISK' AND created_at < NOW() - (p_default_days || ' days')::INTERVAL)
             )
       ORDER BY created_at ASC
       LIMIT p_batch_size
    ) t;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    moved_reports := 0;
    moved_links := 0;
    moved_cluster_links := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Copy links first (FK cascade would drop them if we deleted reports first).
  WITH moved AS (
    INSERT INTO report_entity_links_archive
      (id, report_id, entity_id, extraction_method, role, created_at)
    SELECT id, report_id, entity_id, extraction_method, role, created_at
      FROM report_entity_links
     WHERE report_id = ANY(v_ids)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_moved_links FROM moved;

  DELETE FROM report_entity_links WHERE report_id = ANY(v_ids);

  -- cluster_reports is the v22 junction table; same treatment. Guard with an
  -- IF-EXISTS so this migration still applies on stacks that never got v22.
  IF to_regclass('public.cluster_reports') IS NOT NULL THEN
    WITH moved AS (
      INSERT INTO cluster_reports_archive
        (id, cluster_id, report_id, created_at)
      SELECT id, cluster_id, report_id, created_at
        FROM cluster_reports
       WHERE report_id = ANY(v_ids)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    )
    SELECT COUNT(*) INTO v_moved_cluster FROM moved;

    DELETE FROM cluster_reports WHERE report_id = ANY(v_ids);
  END IF;

  -- Finally the parent rows.
  WITH moved AS (
    INSERT INTO scam_reports_archive
      (id, reporter_hash, source, input_mode, verdict, confidence_score,
       scam_type, channel, delivery_method, impersonated_brand,
       scrubbed_content, analysis_result, verified_scam_id, region,
       country_code, cluster_id, created_at)
    SELECT id, reporter_hash, source, input_mode, verdict, confidence_score,
           scam_type, channel, delivery_method, impersonated_brand,
           scrubbed_content, analysis_result, verified_scam_id, region,
           country_code, cluster_id, created_at
      FROM scam_reports
     WHERE id = ANY(v_ids)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_moved_reports FROM moved;

  DELETE FROM scam_reports WHERE id = ANY(v_ids);

  moved_reports := v_moved_reports;
  moved_links := v_moved_links;
  moved_cluster_links := v_moved_cluster;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION archive_scam_reports_batch(INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_scam_reports_batch(INT, INT, INT) TO service_role;

-- Convenience: union view so fraud-team code that needs "all reports ever" can
-- query one name. Intentionally service-role-only.
CREATE OR REPLACE VIEW scam_reports_all AS
  SELECT id, reporter_hash, source, input_mode, verdict, confidence_score,
         scam_type, channel, delivery_method, impersonated_brand,
         scrubbed_content, analysis_result, verified_scam_id, region,
         country_code, cluster_id, created_at,
         FALSE AS archived
    FROM scam_reports
  UNION ALL
  SELECT id, reporter_hash, source, input_mode, verdict, confidence_score,
         scam_type, channel, delivery_method, impersonated_brand,
         scrubbed_content, analysis_result, verified_scam_id, region,
         country_code, cluster_id, created_at,
         TRUE AS archived
    FROM scam_reports_archive;
