-- v271: persist which story each monthly Clone Watch edition spotlighted.
--
-- Slide 3 previously picked by CATEGORY (any super fund present wins), which
-- repeats: HESTA led both June and July 2026 and took the spotlight twice
-- while the month's real news (Apple 42->85, Google 21->54, two first-time
-- entrants) went untold. The replacement is a news-value ladder — biggest
-- month-over-month mover -> first-time entrant -> super fund -> globals — with
-- a hard "never the same brand as last month" rule.
--
-- That rule needs to know what was actually published last month, so we record
-- it. Editions before this column fall back to `super_fund`, which is exactly
-- what they showed, so no backfill is required.
--
-- Idempotent; additive only (no rewrite of the existing jsonb columns).

ALTER TABLE public.clone_watch_report_summary
  ADD COLUMN IF NOT EXISTS spotlight jsonb;

COMMENT ON COLUMN public.clone_watch_report_summary.spotlight IS
  'The story slide 3 led with: {kind: mover|new_entrant|super_fund|globals, brand, clones, auRank, priorClones?, delta?}. Read by the next month''s ladder to prevent a repeat spotlight (v271).';
