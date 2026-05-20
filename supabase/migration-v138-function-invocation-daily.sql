-- migration-v138-function-invocation-daily.sql
-- Per-day invocation counts for Inngest functions and Vercel crons.
--
-- Written by function-invocation-audit at 02:15 UTC. One row per
-- (date, function_name); source distinguishes derived Vercel cron counts
-- from Inngest /v1/events counts. Lean observability table, no public access.

BEGIN;

CREATE TABLE IF NOT EXISTS public.function_invocation_daily (
  date             date         NOT NULL,
  function_name    text         NOT NULL,
  invocations      int          NOT NULL DEFAULT 0,
  avg_duration_ms  int,
  source           text         NOT NULL,
  ingested_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (date, function_name),
  CONSTRAINT function_invocation_daily_source_check
    CHECK (source IN ('vercel-cron', 'inngest')),
  CONSTRAINT function_invocation_daily_invocations_check
    CHECK (invocations >= 0),
  CONSTRAINT function_invocation_daily_avg_duration_check
    CHECK (avg_duration_ms IS NULL OR avg_duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_function_invocation_daily_source_date
  ON public.function_invocation_daily (source, date DESC);

CREATE INDEX IF NOT EXISTS idx_function_invocation_daily_invocations
  ON public.function_invocation_daily (date DESC, invocations DESC);

ALTER TABLE public.function_invocation_daily ENABLE ROW LEVEL SECURITY;

-- Service role writes from Inngest and admin pages read through service role.
-- No anon/authenticated policy is needed.

COMMIT;
