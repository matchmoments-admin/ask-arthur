-- migration-v62-cost-telemetry.sql
-- Adds cost_telemetry table for tracking per-call AI / paid-API spend.
-- Populated via apps/web/lib/cost-telemetry.ts `logCost()` helper
-- (fire-and-forget, wrapped in waitUntil so inserts survive response end on Vercel).

create extension if not exists "pgcrypto";

create table if not exists public.cost_telemetry (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  feature            text not null,
  provider           text not null,
  operation          text not null,
  units              numeric(18, 6)  not null default 1,
  unit_cost_usd      numeric(18, 10) not null default 0,
  estimated_cost_usd numeric(18, 10) not null default 0,
  metadata           jsonb not null default '{}'::jsonb,
  user_id            uuid null,
  request_id         text null
);

comment on table public.cost_telemetry is
  'Per-call AI/paid-API cost events. Populated from apps/web/lib/cost-telemetry.ts. Service role writes only; no public SELECT policy.';

create index if not exists idx_cost_telemetry_feature_created_at
  on public.cost_telemetry (feature, created_at desc);

create index if not exists idx_cost_telemetry_provider_created_at
  on public.cost_telemetry (provider, created_at desc);

-- BRIN is near-free on insert and scans time-ranged queries in ms at scale.
create index if not exists idx_cost_telemetry_created_at_brin
  on public.cost_telemetry using brin (created_at);

alter table public.cost_telemetry enable row level security;

-- Drop + recreate the views (idempotent on re-apply).
drop view if exists public.today_cost_total;
drop view if exists public.daily_cost_summary;

create view public.daily_cost_summary as
  select
    date_trunc('day', created_at at time zone 'UTC')::date as day,
    feature,
    provider,
    count(*)                    as event_count,
    sum(estimated_cost_usd)     as total_cost_usd,
    avg(estimated_cost_usd)     as avg_cost_usd
  from public.cost_telemetry
  group by 1, 2, 3;

create view public.today_cost_total as
  select
    coalesce(sum(estimated_cost_usd), 0) as total_cost_usd,
    count(*)                             as event_count
  from public.cost_telemetry
  where created_at >= date_trunc('day', now() at time zone 'UTC');
