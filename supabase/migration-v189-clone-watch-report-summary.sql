-- v189: clone_watch_report_summary
--
-- Durable monthly Clone Watch aggregate snapshot — one row per report month
-- (the prior calendar month). Populated by the `clone-watch-report-summary`
-- Inngest function, which reuses getCloneWatchReportCard() — the single source
-- of truth that reconciles EXACTLY to the internal Telegram digest
-- (June 2026 = 804 detected / 129 brands / 628 Netcraft / 25 phishing /
-- 51 parked / 378 WHOIS-hidden).
--
-- This is the durable spine for: the recurring LinkedIn automation (MoM deltas,
-- the caption, the edition record), the future public monthly-index pages
-- (/clone-watch/[yyyy-mm]), and JSONB-pruning of the raw shopfront_clone_alerts
-- rows once a month's aggregates are safely persisted here.
--
-- Idempotent: re-runnable (CREATE TABLE IF NOT EXISTS, idempotent RLS/REVOKE).

CREATE TABLE IF NOT EXISTS public.clone_watch_report_summary (
  period_month            date PRIMARY KEY,          -- month start, e.g. 2026-06-01
  total_domains           integer NOT NULL DEFAULT 0,
  brand_count             integer NOT NULL DEFAULT 0,
  reported_to_netcraft    integer NOT NULL DEFAULT 0,
  likely_phishing         integer NOT NULL DEFAULT 0,
  parked_for_sale         integer NOT NULL DEFAULT 0,
  unknown_registrar_count integer NOT NULL DEFAULT 0,
  top_au_brands           jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- [{brand,clones}]
  global_brands           jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- [{brand,clones}]
  top_registrars          jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- [{registrar,clones}]
  super_fund              jsonb,                                 -- {brand,clones,auRank} | null
  mom                     jsonb,                                 -- MonthOverMonth | null
  published_post_urn      text,                                  -- set after the LinkedIn publish
  generated_at            timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clone_watch_report_summary IS
  'Durable monthly Clone Watch aggregate snapshot (one row/report month). Source of truth = getCloneWatchReportCard; reconciles to the internal digest. Powers the LinkedIn automation, future public monthly-index pages, and raw-row JSONB pruning.';

ALTER TABLE public.clone_watch_report_summary ENABLE ROW LEVEL SECURITY;

-- Service-role only for now (service role bypasses RLS). No anon/authenticated
-- policies = deny by default. The public monthly-index pages (WS3 §2) will add
-- a read policy when they ship. Revoke direct grants to match the db-hygiene
-- posture (mirrors migration-v114-revoke-anon-*).
REVOKE ALL ON public.clone_watch_report_summary FROM anon, authenticated;
