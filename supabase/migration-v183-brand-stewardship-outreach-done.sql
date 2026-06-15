-- v183 — Manual-outreach tracking for no-contact brand-stewardship rows.
--
-- The dashboard's "Manual outreach — no security contact" worklist lets the
-- operator work through clone-targeted brands we can't email (no known_brands
-- contact) by sending a LinkedIn message. These columns persist a "done" tick
-- per row so the worklist survives refreshes and the operator can track
-- progress. Done-state is naturally per-month: each month's run creates fresh
-- rows (status='skipped'/'no_contact', new period_month) with outreach_done_at
-- NULL, so the worklist resets automatically.

ALTER TABLE public.brand_stewardship_reports
  ADD COLUMN IF NOT EXISTS outreach_done_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outreach_done_by TEXT;

COMMENT ON COLUMN public.brand_stewardship_reports.outreach_done_at IS
  'When the operator marked manual outreach (e.g. LinkedIn DM) complete for a no_contact row. NULL = still on the worklist.';
