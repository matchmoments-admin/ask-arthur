-- v297: constrain the coverage join key (#1075, review of PR #1076).
--
-- v295 added `brand_domain` and documented it as "prefer this key", but left it
-- nullable and unconstrained. Given the trend gate FAILS CLOSED on a missing
-- coverage record, a single NULL here silently suppresses that brand's trend
-- claims forever — no error, no log, and the brand simply never appears in a
-- report again. A key whose absence is invisible has to be impossible to omit.
--
-- Two data defects found in the same review are repaired by re-running the
-- backfill (which now dedupes on the brand key and stamps covered_to), not by
-- SQL here, so that the script and the table cannot disagree:
--
--   * Medicare and Centrelink had NO coverage row at all. Three watchlist
--     entries share servicesaustralia.gov.au — Services Australia, Medicare,
--     Centrelink — and the backfill deduped on the DOMAIN, keeping only the
--     first. The 293-row total still reconciled to the watchlist size, which is
--     exactly why it looked correct.
--   * Domain (domain.com.au) and Lendi (lendi.com.au) were removed from the
--     watchlist but carry covered_to = NULL, so they read as permanently
--     covered. Their drop to zero detections would have published as
--     "targeting collapsed" rather than "we stopped watching" — the inverse of
--     the bug this table exists to prevent.
--
-- Ordering matters: the backfill re-run must happen BEFORE the NOT NULL below
-- can be trusted, and this migration is written to be applied after it.

BEGIN;

-- Every existing row was written by the backfill with a domain; this makes the
-- guarantee structural rather than incidental.
ALTER TABLE public.brand_coverage_history
  ALTER COLUMN brand_domain SET NOT NULL;

-- A coverage window that ends before it starts is not a window. Cheap, and it
-- catches a covered_to stamped from the wrong revision.
ALTER TABLE public.brand_coverage_history
  DROP CONSTRAINT IF EXISTS brand_coverage_history_window_ordered;
ALTER TABLE public.brand_coverage_history
  ADD CONSTRAINT brand_coverage_history_window_ordered
  CHECK (covered_to IS NULL OR covered_to > covered_from);

COMMIT;
