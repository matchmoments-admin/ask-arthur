-- migration-v72-partition-rls.sql
--
-- Follow-up to v71. In Postgres, RLS on a partitioned parent does NOT
-- propagate to individual partition tables — each child needs its own ALTER
-- TABLE ... ENABLE ROW LEVEL SECURITY. Same for policies: the parent policy
-- applies when querying the parent, but direct queries against a partition
-- child (e.g. during maintenance) bypass it.
--
-- This migration enables RLS on every existing partition and amends
-- ensure_monthly_partition() so future partitions get RLS at creation time.
-- It also converts the scam_reports_all view to security_invoker=true so RLS
-- is evaluated as the querying role rather than the view owner.

-- =============================================================================
-- Backfill RLS on existing partitions.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS fq_name
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname IN (
             'cost_telemetry_partitioned',
             'scam_reports_partitioned',
             'feed_items_partitioned'
           )
       AND c.relkind = 'r'
  LOOP
    EXECUTE FORMAT('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.fq_name);
    EXECUTE FORMAT('ALTER TABLE %s FORCE ROW LEVEL SECURITY', r.fq_name);
  END LOOP;
END $$;

-- =============================================================================
-- Update helper so newly-created partitions enable RLS automatically.
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
  EXECUTE FORMAT('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_part_name);
  EXECUTE FORMAT('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_part_name);
END;
$$;

REVOKE ALL ON FUNCTION ensure_monthly_partition(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_monthly_partition(TEXT, DATE) TO service_role;

-- =============================================================================
-- scam_reports_all: recreate with security_invoker so the view inherits the
-- caller's role instead of running as the view owner (Supabase advisor 0010).
-- =============================================================================

DROP VIEW IF EXISTS scam_reports_all;

CREATE VIEW scam_reports_all
  WITH (security_invoker = true)
  AS
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
