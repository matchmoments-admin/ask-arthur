-- Migration v65: feature_brakes — generic per-feature kill-switch table.
--
-- Phase 14 Sprint 2 PR B3 introduces the first consumer: the cost-daily-check
-- cron sets paused_until='now()+24h' for feature='vuln_au_enrichment' when
-- that feature's cost exceeds DAILY_COST_THRESHOLD_USD. The enrichment
-- Inngest function reads this row before every Claude call and returns
-- early with status='paused' if the row is present and in-date.
--
-- Generic by design — future expensive operations (bulk Claude backfills,
-- deepfake detection, Hive AI image scans) can share the same brake
-- mechanism without new schema. A single row per feature; absence of a
-- row means "not braked".

CREATE TABLE IF NOT EXISTS feature_brakes (
  feature TEXT PRIMARY KEY,
  paused_until TIMESTAMPTZ NOT NULL,
  reason TEXT,
  set_by TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  set_cost_usd NUMERIC(10, 4),
  set_threshold_usd NUMERIC(10, 4)
);

COMMENT ON TABLE feature_brakes IS
  'Generic per-feature kill-switch — an Inngest function or route handler can check '
  'this table before doing expensive work. Populated by cost-daily-check cron when '
  'a feature exceeds its daily budget. Auto-releases via the paused_until timestamp '
  'so the brake lifts itself the next day without manual intervention.';

COMMENT ON COLUMN feature_brakes.feature IS
  'Matches cost_telemetry.feature so the brake row keys off the same identifier '
  'that shows up on /admin/costs.';

COMMENT ON COLUMN feature_brakes.paused_until IS
  'Callers check NOW() < paused_until. When paused_until is in the past the row '
  'is ignored (no explicit DELETE needed, though a weekly prune is fine).';

-- Match v62 cost_telemetry pattern: no RLS, writes go through the service-role
-- client only. Admin reads go via /admin pages that authenticate through
-- requireAdmin() at the route handler layer.
