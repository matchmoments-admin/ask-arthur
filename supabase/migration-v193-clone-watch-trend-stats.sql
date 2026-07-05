-- migration-v193-clone-watch-trend-stats.sql
-- Per-(month, brand) and per-(month, registrar) trend rows for Clone Watch.
--
-- WHY: clone_watch_report_summary (v189) keeps only top-N brands/registrars as
-- JSONB in one row/month, so you can't query "this brand over time". These
-- normalized tables hold the FULL per-brand and per-registrar counts per month,
-- written by the same monthly snapshot cron, enabling per-brand / per-registrar
-- MoM trends on the owned-media pages.
--
-- Not hot tables (a few hundred rows/month, monthly delete+insert). Deny-all
-- RLS; service_role bypass — same posture as clone_watch_report_summary (v189).

BEGIN;

CREATE TABLE IF NOT EXISTS public.clone_watch_monthly_brand_stats (
  period_month         date    NOT NULL,   -- month start, e.g. 2026-06-01
  brand                text    NOT NULL,
  is_au                boolean NOT NULL DEFAULT false,
  clones               integer NOT NULL DEFAULT 0,
  reported_to_netcraft integer NOT NULL DEFAULT 0,
  likely_phishing      integer NOT NULL DEFAULT 0,
  parked               integer NOT NULL DEFAULT 0,
  PRIMARY KEY (period_month, brand)
);
CREATE INDEX IF NOT EXISTS idx_cw_brand_stats_brand
  ON public.clone_watch_monthly_brand_stats (brand, period_month DESC);

CREATE TABLE IF NOT EXISTS public.clone_watch_monthly_registrar_stats (
  period_month date    NOT NULL,
  registrar    text    NOT NULL,
  clones       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (period_month, registrar)
);
CREATE INDEX IF NOT EXISTS idx_cw_registrar_stats_registrar
  ON public.clone_watch_monthly_registrar_stats (registrar, period_month DESC);

ALTER TABLE public.clone_watch_monthly_brand_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clone_watch_monthly_registrar_stats ENABLE ROW LEVEL SECURITY;
-- Deny-all default; service_role bypasses RLS. Same posture as v189.
REVOKE ALL ON public.clone_watch_monthly_brand_stats FROM anon, authenticated;
REVOKE ALL ON public.clone_watch_monthly_registrar_stats FROM anon, authenticated;

COMMIT;
