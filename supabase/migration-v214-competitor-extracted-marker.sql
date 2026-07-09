-- v214 — feed_items.competitor_extracted_at: extraction attempt-marker.
--
-- Why (ultrareview HIGH H2): the Phase 2 extraction cron inferred "done" from
-- "has competitor_intel_observations rows". But a newsletter that yields NO
-- scams (subscription confirmations, welcome emails, quiet issues — the system
-- prompt explicitly returns []) writes no observation rows, so it stayed a
-- candidate and got re-sent to Sonnet every 6h for the whole 45-day lookback
-- (~180 wasted paid calls per empty email). Mirror the feed-items-embed pattern:
-- put the done-marker on the row itself, set on EVERY attempt (including
-- zero-yield), and select candidates on IS NULL.
--
-- Nullable, no backfill, no table rewrite. The partial index bounds the cron's
-- candidate scan to un-attempted competitor rows only (tiny — competitor volume
-- is a handful/week).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

ALTER TABLE public.feed_items
  ADD COLUMN IF NOT EXISTS competitor_extracted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_feed_items_competitor_unextracted
  ON public.feed_items (created_at DESC)
  WHERE category = 'competitor_intel' AND competitor_extracted_at IS NULL;

COMMENT ON COLUMN public.feed_items.competitor_extracted_at IS
  'Set by the competitor-intel-extract cron once a competitor_intel newsletter has been through extraction (v214, ADR-0021). Marks attempt, not yield — a zero-scam newsletter is still marked so it is not re-extracted. NULL = not yet attempted.';
