-- Migration v112: cost_telemetry retention (Phase 2.1)
--
-- Adds bounded retention to a previously-unbounded telemetry table.
-- Pattern:
--   1. Roll daily aggregates into cost_telemetry_daily_rollup (small,
--      bounded ~10 rows/day × 365d = ~3.6k/year). Driven by an
--      idempotent RPC so re-running is safe.
--   2. Prune cost_telemetry rows >90 days old via a separate RPC.
--   3. Inngest cron (next file) calls roll-then-prune nightly so the
--      rollup captures every event before raw data is dropped.
--
-- The rollup uses a TABLE with ON CONFLICT upsert rather than a
-- materialised view because:
--   - Plain refresh = full rebuild (slow as cost_telemetry grows).
--   - REFRESH CONCURRENTLY needs a UNIQUE index that's redundant with
--     the natural PK we already want on (day, feature, provider).
--   - Upsert pattern is partial-update friendly: re-roll just yesterday
--     to catch late-arriving events without rebuilding 365 days.
--
-- The existing daily_cost_summary VIEW continues to read raw
-- cost_telemetry — useful for the last-90d ad-hoc /admin/costs queries.
-- For long-range analytics (>90d), callers should query the rollup
-- instead.

-- ─── 1. Rollup table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cost_telemetry_daily_rollup (
  day               DATE   NOT NULL,
  feature           TEXT   NOT NULL,
  provider          TEXT   NOT NULL,
  event_count       INT    NOT NULL DEFAULT 0,
  total_cost_usd    NUMERIC(18, 10) NOT NULL DEFAULT 0,
  avg_cost_usd      NUMERIC(18, 10),
  rolled_up_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, feature, provider)
);

ALTER TABLE public.cost_telemetry_daily_rollup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_anon_authenticated
  ON public.cost_telemetry_daily_rollup;
CREATE POLICY deny_all_anon_authenticated
  ON public.cost_telemetry_daily_rollup
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_cost_telemetry_daily_rollup_day
  ON public.cost_telemetry_daily_rollup (day DESC);

CREATE INDEX IF NOT EXISTS idx_cost_telemetry_daily_rollup_feature
  ON public.cost_telemetry_daily_rollup (feature, day DESC);

-- ─── 2. Refresh RPC ──────────────────────────────────────────────────────
-- Re-aggregates p_days days of raw cost_telemetry into the rollup.
-- Default 7d window covers any cron-skipped nights without forcing a
-- 365-day reaggregate every run.
CREATE OR REPLACE FUNCTION public.refresh_cost_telemetry_daily_rollup(
  p_days INT DEFAULT 7
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rolled INT;
BEGIN
  WITH agg AS (
    SELECT (date_trunc('day', created_at AT TIME ZONE 'UTC'))::DATE AS day,
           feature,
           provider,
           count(*)                AS event_count,
           sum(estimated_cost_usd) AS total_cost_usd,
           avg(estimated_cost_usd) AS avg_cost_usd
    FROM public.cost_telemetry
    WHERE created_at >= NOW() - (p_days || ' days')::INTERVAL
    GROUP BY 1, 2, 3
  ), upserted AS (
    INSERT INTO public.cost_telemetry_daily_rollup
      (day, feature, provider, event_count, total_cost_usd, avg_cost_usd, rolled_up_at)
    SELECT day, feature, provider, event_count, total_cost_usd, avg_cost_usd, NOW()
    FROM agg
    ON CONFLICT (day, feature, provider) DO UPDATE SET
      event_count    = EXCLUDED.event_count,
      total_cost_usd = EXCLUDED.total_cost_usd,
      avg_cost_usd   = EXCLUDED.avg_cost_usd,
      rolled_up_at   = EXCLUDED.rolled_up_at
    RETURNING 1
  )
  SELECT count(*) INTO v_rolled FROM upserted;
  RETURN v_rolled;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_cost_telemetry_daily_rollup(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_cost_telemetry_daily_rollup(INT) TO service_role;

-- ─── 3. Prune RPC ────────────────────────────────────────────────────────
-- Deletes raw cost_telemetry rows older than p_days. Should ALWAYS be
-- called AFTER refresh_cost_telemetry_daily_rollup so the rollup
-- captures the rows being deleted.
CREATE OR REPLACE FUNCTION public.prune_cost_telemetry(
  p_days INT DEFAULT 90
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.cost_telemetry
  WHERE created_at < NOW() - (p_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_cost_telemetry(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_cost_telemetry(INT) TO service_role;

-- ─── 4. Backfill the rollup with all existing cost_telemetry data ───────
-- Run once at migration apply: covers every existing cost_telemetry row
-- so we don't lose data when the first prune runs (90d window starts
-- from migration apply).
SELECT public.refresh_cost_telemetry_daily_rollup(36500); -- effectively all-time
