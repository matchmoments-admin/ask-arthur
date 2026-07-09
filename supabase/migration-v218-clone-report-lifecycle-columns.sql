-- migration-v218-clone-report-lifecycle-columns.sql
--
-- Clone-Watch — brand-story reporting, Part B (PR3.2). Adds the lifecycle-
-- transition metrics to the two PRECOMPUTED, brand-read stats tables so reports
-- can tell the takedown + "Netcraft declined it, it's sitting parked" story
-- without any live scan. The PR3.1 reconciler populates the underlying
-- lifecycle_state / netcraft_declined_at / weaponised_at; the monthly
-- aggregation cron (clone-watch-report-summary) writes these columns.
--
-- Additive, idempotent (ADD COLUMN IF NOT EXISTS), default 0 — a re-snapshot
-- backfills them. No RLS change (existing table policies apply). See
-- docs/plans/clone-watch-brand-story-reporting.md §3 Part B.

-- Overall monthly summary (one row per period_month).
ALTER TABLE public.clone_watch_report_summary
  ADD COLUMN IF NOT EXISTS taken_down    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS declined      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalated     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weaponised    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS re_taken_down integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.clone_watch_report_summary.declined IS
  'Clones Netcraft graded non-malicious (lifecycle declined) — still live/parked, "unactioned lookalikes". The story no commercial vendor tells.';
COMMENT ON COLUMN public.clone_watch_report_summary.re_taken_down IS
  'Declined → we filed report_issue → then taken_down. The "we forced it through" win.';

-- Per-brand trend rows (delete-then-insert monthly).
ALTER TABLE public.clone_watch_monthly_brand_stats
  ADD COLUMN IF NOT EXISTS taken_down integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS declined   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalated  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weaponised integer NOT NULL DEFAULT 0;
