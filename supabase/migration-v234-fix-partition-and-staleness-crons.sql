-- migration-v234-fix-partition-and-staleness-crons.sql
--
-- Fixes two chronic background-cron failures that had fired daily since
-- 2026-04-23 (~85 days) with nobody paged — the noise from the middleware
-- fictional-timeout bug (fixed separately) had masked them in the logs.
--
-- 1. ensure-partitions (/api/cron/ensure-partitions → ensure_next_month_partitions)
--    was failing with `permission denied for schema public`. The two partition
--    helpers were SECURITY INVOKER, so they ran as `service_role`, which on
--    Supabase does NOT hold CREATE on schema public (only the owner role does).
--    Their `EXECUTE 'CREATE TABLE ... PARTITION OF ...'` therefore always
--    denied. Consequence: no next-month partition has been created since April;
--    the last partition on all three shadow tables was y2026m06 (June). The
--    tables are still empty v71 scaffolds (0 rows) so nothing broke YET, but the
--    eventual cutover would fail and the cron erroring daily was pure noise.
--
--    Fix: make both helpers SECURITY DEFINER (run as the CREATE-capable owner),
--    per supabase/CLAUDE.md rule 4 keep a minimal `search_path = pg_catalog`
--    (so built-ins resolve) and fully-qualify every `public.` object in the
--    dynamic SQL — the functions take only trusted constant parents and are
--    service_role-only, so the unqualified-name threat model is covered.
--    ensure_next_month_partitions is also made self-healing: it now creates the
--    CURRENT month too, so a gap after downtime auto-recovers on the next run.
--    Finally we call it once here to backfill the partitions the dead cron
--    missed (July onward, 2026).
--
-- 2. pipeline-staleness-check-ips → mark_stale_ips was failing with
--    `canceling statement due to statement timeout`. The single UPDATE matches
--    ~9,700 rows on a 639K-row scam_ips table carrying a GIN index
--    (idx_scam_ips_feed_sources); every row update dirties the GIN index, and
--    the unbounded UPDATE exceeded the pooler's 2-min cap. Per the root
--    CLAUDE.md incident-2026-05-09 rule ("chunk + finite cap, never raise the
--    timeout to unbounded"), mark_stale_ips now takes p_limit and updates one
--    bounded batch per call under a finite SET LOCAL statement_timeout; the
--    caller loops until the batch drains. Signature widens from (int) to
--    (int,int) with a default, so existing named-arg callers keep working.
--
-- Idempotent: CREATE OR REPLACE + DROP IF EXISTS + IF NOT EXISTS partitions.
-- Reverse: re-apply the v71/v14 bodies (SECURITY INVOKER / single-shot UPDATE);
-- no data is destroyed by this migration.

-- ---------------------------------------------------------------------------
-- 1. Partition maintenance — SECURITY DEFINER
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_monthly_partition(
  p_parent TEXT,
  p_month DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_part_name TEXT;
  v_start DATE;
  v_end DATE;
BEGIN
  v_start := date_trunc('month', p_month)::DATE;
  v_end := (v_start + INTERVAL '1 month')::DATE;
  v_part_name := format('%s_y%sm%s', p_parent,
    to_char(v_start, 'YYYY'),
    to_char(v_start, 'MM'));

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
    v_part_name, p_parent, v_start, v_end
  );

  -- Match the parent's posture: every partition is its own relation exposed to
  -- PostgREST, so it needs RLS enabled independently (the advisor errors on a
  -- public partition without it). The parent's policies still govern queries
  -- via the parent; service_role bypasses RLS. Idempotent.
  EXECUTE format(
    'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
    v_part_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_monthly_partition(TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_monthly_partition(TEXT, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_next_month_partitions()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_cur DATE := date_trunc('month', now())::DATE;
  v_next DATE := (date_trunc('month', now()) + INTERVAL '1 month')::DATE;
  v_next_plus DATE := (date_trunc('month', now()) + INTERVAL '2 months')::DATE;
  v_parent TEXT;
BEGIN
  FOREACH v_parent IN ARRAY ARRAY[
    'cost_telemetry_partitioned',
    'scam_reports_partitioned',
    'feed_items_partitioned'
  ]
  LOOP
    -- Current month included so a post-downtime gap self-heals on next run.
    PERFORM public.ensure_monthly_partition(v_parent, v_cur);
    PERFORM public.ensure_monthly_partition(v_parent, v_next);
    PERFORM public.ensure_monthly_partition(v_parent, v_next_plus);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_next_month_partitions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_next_month_partitions() TO service_role;

-- Backfill the partitions the dead cron missed (creates current + next + next+1
-- for all three shadow tables; IF NOT EXISTS makes existing ones a no-op).
SELECT public.ensure_next_month_partitions();

-- Backfill RLS on any partition created before ensure_monthly_partition began
-- enabling it (the partitions this migration created above pre-date that line
-- on first apply). Idempotent — only touches partitions still missing RLS.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT child.relname AS partition_name
    FROM pg_inherits i
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_class child  ON child.oid  = i.inhrelid
    JOIN pg_namespace n  ON n.oid = child.relnamespace
    WHERE n.nspname = 'public'
      AND parent.relname IN (
        'cost_telemetry_partitioned',
        'scam_reports_partitioned',
        'feed_items_partitioned'
      )
      AND child.relrowsecurity = FALSE
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.partition_name);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. mark_stale_ips — bounded batch to stop the statement-timeout failures
-- ---------------------------------------------------------------------------

-- Old single-arg signature is replaced by the (int, int) batched form.
DROP FUNCTION IF EXISTS public.mark_stale_ips(INT);

CREATE OR REPLACE FUNCTION public.mark_stale_ips(
  p_stale_days INT DEFAULT 7,
  p_limit INT DEFAULT 5000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Finite cap (never 0/unbounded per incident 2026-05-09); one call = one
  -- bounded batch, the caller loops until a short batch signals drain.
  SET LOCAL statement_timeout = '90s';

  UPDATE scam_ips
  SET is_active = FALSE,
      staleness_checked_at = NOW()
  WHERE id IN (
    SELECT id
    FROM scam_ips
    WHERE is_active = TRUE
      AND last_seen_in_feed IS NOT NULL
      AND last_seen_in_feed < NOW() - (p_stale_days || ' days')::INTERVAL
      AND confidence_level NOT IN ('high', 'confirmed')
    ORDER BY id
    LIMIT p_limit
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days,
    'batch_limit', p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_ips(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_ips(INT, INT) TO service_role;
