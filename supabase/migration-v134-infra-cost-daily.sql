-- migration-v134-infra-cost-daily.sql
-- Per-day infra-spend rollup across providers.
--
-- /admin/costs (v62 + later) tracks per-call AI spend via cost_telemetry —
-- granular and event-driven. This table is the COMPLEMENTARY surface for
-- non-event-driven costs: the daily billing the cloud providers report
-- via their FOCUS-billing / usage APIs. One row per (date, provider).
--
-- Providers landed by the v134 Inngest function billing-ingest-nightly
-- (02:00 UTC daily):
--   - 'vercel'        — sum of EffectiveCost from /v1/billing/charges per day
--   - 'anthropic'     — sum of cost_telemetry.estimated_cost_usd per day
--   - 'supabase-base' — $25/30 of the Pro tier base monthly fee, prorated
--
-- Future providers (deferred from #299 scope):
--   - 'github-actions' — needs gh-token `user` scope refresh
--   - 'supabase-compute', '-storage', '-egress' — no public usage API yet
--
-- Lean (5 cols, no hot-table risk). PK enables idempotent upsert on re-run.
-- usd_cents stays integer for clean SUM aggregation without float drift.

BEGIN;

CREATE TABLE IF NOT EXISTS public.infra_cost_daily (
  date              date         NOT NULL,
  provider          text         NOT NULL,
  usd_cents         int          NOT NULL,
  raw_usage_jsonb   jsonb,
  ingested_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (date, provider)
);

CREATE INDEX IF NOT EXISTS idx_infra_cost_daily_provider_date
  ON public.infra_cost_daily (provider, date DESC);

-- Service role writes (Inngest function). Admin pages read via service role.
-- No public/anon access — same posture as cost_telemetry.
ALTER TABLE public.infra_cost_daily ENABLE ROW LEVEL SECURITY;

-- Deny-all default; service_role bypasses RLS so it doesn't need a policy.
-- This is the same pattern v109 (deny-all-policies-followup) established.

COMMIT;
