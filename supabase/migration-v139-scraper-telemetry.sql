-- migration-v139-scraper-telemetry.sql
-- Per-scraper daily efficiency telemetry for /admin/costs/infra.
--
-- Populated by Inngest function scraper-cost-audit (02:10 UTC daily).
-- rows_added comes from destination-table inserts for the source; runtime
-- and runs come from GitHub Actions job-step durations.
--
-- One lean row per (date, source). Idempotent upsert target for re-runs.

BEGIN;

CREATE TABLE IF NOT EXISTS public.scraper_telemetry (
  date             date         NOT NULL,
  source           text         NOT NULL,
  rows_added       int          NOT NULL DEFAULT 0 CHECK (rows_added >= 0),
  runtime_seconds  int          NOT NULL DEFAULT 0 CHECK (runtime_seconds >= 0),
  runs             int          NOT NULL DEFAULT 0 CHECK (runs >= 0),
  ingested_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (date, source)
);

CREATE INDEX IF NOT EXISTS idx_scraper_telemetry_source_date
  ON public.scraper_telemetry (source, date DESC);

-- Service role writes (Inngest function). Admin pages read via service role.
-- No public/anon access; service_role bypasses RLS.
ALTER TABLE public.scraper_telemetry ENABLE ROW LEVEL SECURITY;

COMMIT;
