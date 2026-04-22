-- migration-v71-partitioning-scaffold.sql
--
-- Scaffolds monthly RANGE partitioning for the three unbounded hot tables:
--   cost_telemetry, scam_reports, feed_items
--
-- SAFE TO APPLY: this migration ONLY creates _partitioned shell tables and a
-- helper function for monthly partition management. It does NOT move data or
-- rename anything — the actual cutover is an operator-driven step documented
-- in docs/partitioning-runbook.md and executed during a maintenance window.
--
-- Why scaffold separately: an in-place ATTACH/DETACH rewrite of a multi-GB
-- table requires a brief exclusive lock that we don't want to take as part of
-- a routine migration run. Keeping the scaffold separate means the day this
-- file lands, nothing in production changes.

-- =============================================================================
-- Helper: ensure_monthly_partition — idempotent partition creation.
-- =============================================================================

CREATE OR REPLACE FUNCTION ensure_monthly_partition(
  p_parent TEXT,
  p_month DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_part_name TEXT;
  v_start DATE;
  v_end DATE;
BEGIN
  v_start := DATE_TRUNC('month', p_month)::DATE;
  v_end := (v_start + INTERVAL '1 month')::DATE;
  v_part_name := FORMAT('%s_y%sm%s', p_parent,
    TO_CHAR(v_start, 'YYYY'),
    TO_CHAR(v_start, 'MM'));

  EXECUTE FORMAT(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    v_part_name, p_parent, v_start, v_end
  );
END;
$$;

REVOKE ALL ON FUNCTION ensure_monthly_partition(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_monthly_partition(TEXT, DATE) TO service_role;

-- =============================================================================
-- cost_telemetry_partitioned — shell that will eventually replace cost_telemetry.
--
-- Column list mirrors cost_telemetry (v62). Keep these in sync whenever
-- cost_telemetry evolves. Partition key: created_at (DATE_TRUNC to month).
-- =============================================================================

CREATE TABLE IF NOT EXISTS cost_telemetry_partitioned (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY,
  feature             TEXT NOT NULL,
  provider            TEXT NOT NULL,
  operation           TEXT NOT NULL,
  units               NUMERIC,
  unit_cost_usd       NUMERIC,
  estimated_cost_usd  NUMERIC NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}',
  user_id             UUID,
  request_id          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_ctp_feature_created
  ON cost_telemetry_partitioned (feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctp_provider_created
  ON cost_telemetry_partitioned (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctp_user_created
  ON cost_telemetry_partitioned (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE cost_telemetry_partitioned ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages cost_telemetry_partitioned"
  ON cost_telemetry_partitioned;
CREATE POLICY "Service role manages cost_telemetry_partitioned"
  ON cost_telemetry_partitioned FOR ALL
  USING (auth.role() = 'service_role');

-- Seed 6 months: current, 3 back, 2 forward. Cron below keeps the forward
-- window populated so inserts never hit the default-partition trap.
DO $$
DECLARE
  m INT;
BEGIN
  FOR m IN -3..2 LOOP
    PERFORM ensure_monthly_partition(
      'cost_telemetry_partitioned',
      (DATE_TRUNC('month', NOW()) + (m || ' months')::INTERVAL)::DATE
    );
  END LOOP;
END $$;

-- =============================================================================
-- scam_reports_partitioned — shell. Cutover is operator-driven (see runbook).
-- Column list mirrors scam_reports (v21) plus any columns added through v67.
-- =============================================================================

CREATE TABLE IF NOT EXISTS scam_reports_partitioned (
  id               BIGINT GENERATED ALWAYS AS IDENTITY,
  reporter_hash    TEXT NOT NULL,
  source           TEXT NOT NULL,
  input_mode       TEXT,
  verdict          TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  scam_type        TEXT,
  channel          TEXT,
  delivery_method  TEXT,
  impersonated_brand TEXT,
  scrubbed_content TEXT,
  analysis_result  JSONB NOT NULL DEFAULT '{}',
  verified_scam_id BIGINT,
  region           TEXT,
  country_code     TEXT,
  cluster_id       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_srp_verdict_created
  ON scam_reports_partitioned (verdict, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_srp_source_created
  ON scam_reports_partitioned (source, created_at DESC);

ALTER TABLE scam_reports_partitioned ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages scam_reports_partitioned"
  ON scam_reports_partitioned;
CREATE POLICY "Service role manages scam_reports_partitioned"
  ON scam_reports_partitioned FOR ALL
  USING (auth.role() = 'service_role');

DO $$
DECLARE
  m INT;
BEGIN
  FOR m IN -3..2 LOOP
    PERFORM ensure_monthly_partition(
      'scam_reports_partitioned',
      (DATE_TRUNC('month', NOW()) + (m || ' months')::INTERVAL)::DATE
    );
  END LOOP;
END $$;

-- =============================================================================
-- feed_items_partitioned — shell.
-- =============================================================================

CREATE TABLE IF NOT EXISTS feed_items_partitioned (
  id             BIGINT GENERATED ALWAYS AS IDENTITY,
  feed_name      TEXT NOT NULL,
  category       TEXT,
  country        TEXT,
  title          TEXT,
  description    TEXT,
  url            TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}',
  published      BOOLEAN NOT NULL DEFAULT FALSE,
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_fip_feed_created
  ON feed_items_partitioned (feed_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fip_published
  ON feed_items_partitioned (published, created_at DESC)
  WHERE published = TRUE;

ALTER TABLE feed_items_partitioned ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages feed_items_partitioned"
  ON feed_items_partitioned;
CREATE POLICY "Service role manages feed_items_partitioned"
  ON feed_items_partitioned FOR ALL
  USING (auth.role() = 'service_role');

DO $$
DECLARE
  m INT;
BEGIN
  FOR m IN -3..2 LOOP
    PERFORM ensure_monthly_partition(
      'feed_items_partitioned',
      (DATE_TRUNC('month', NOW()) + (m || ' months')::INTERVAL)::DATE
    );
  END LOOP;
END $$;

-- =============================================================================
-- ensure_next_month_partitions — called by a daily cron so inserts landing
-- at the start of a new month always find their partition.
-- =============================================================================

CREATE OR REPLACE FUNCTION ensure_next_month_partitions()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_next DATE := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month')::DATE;
  v_next_plus DATE := (DATE_TRUNC('month', NOW()) + INTERVAL '2 months')::DATE;
BEGIN
  PERFORM ensure_monthly_partition('cost_telemetry_partitioned', v_next);
  PERFORM ensure_monthly_partition('cost_telemetry_partitioned', v_next_plus);
  PERFORM ensure_monthly_partition('scam_reports_partitioned',   v_next);
  PERFORM ensure_monthly_partition('scam_reports_partitioned',   v_next_plus);
  PERFORM ensure_monthly_partition('feed_items_partitioned',     v_next);
  PERFORM ensure_monthly_partition('feed_items_partitioned',     v_next_plus);
END;
$$;

REVOKE ALL ON FUNCTION ensure_next_month_partitions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_next_month_partitions() TO service_role;
