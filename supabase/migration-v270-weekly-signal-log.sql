-- v270: weekly_signal_log — the persisted Monday signal review (#950,
-- admin-console map #939; operationalises docs/ops/weekly-signal-review.md).
--
-- One row per reviewed week, keyed by the UTC Monday. The /admin/weekly-review
-- panel computes the live numbers and a "Record this week" action upserts
-- them here — the recording rule (write it down every week, zero movement
-- for 6 weeks is a decision trigger) becomes computed instead of remembered.
--
-- Service-role only: RLS enabled with no policies (PostgREST anon/authed get
-- nothing; the service key bypasses RLS). Idempotent.

CREATE TABLE IF NOT EXISTS public.weekly_signal_log (
  week_start          date PRIMARY KEY,
  scans_forwarded     integer NOT NULL DEFAULT 0,
  charity_checks      integer NOT NULL DEFAULT 0,
  pageviews           integer NOT NULL DEFAULT 0,
  subscribers_active  integer NOT NULL DEFAULT 0,
  cache_hit_pct       numeric,
  spend_usd           numeric NOT NULL DEFAULT 0,
  notes               text,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.weekly_signal_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.weekly_signal_log IS
  'Weekly signal review log (#950): one row per UTC-Monday week, written from /admin/weekly-review. The 6-week zero-movement rule is computed from consecutive rows.';
