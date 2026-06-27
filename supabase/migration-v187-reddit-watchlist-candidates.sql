-- v187 — reddit_watchlist_candidates: surface Reddit-impersonated brands that
-- aren't yet on the clone-watch monitored set.
--
-- The clone-watch watchlist is a COMPILE-TIME TS array
-- (packages/shopfront-glue/src/au-brand-watchlist.ts); a brand only gets
-- monitored when a human hand-edits that array + re-seeds brand_aliases.
-- reddit_post_intel.brands_impersonated[] is a live feed of which brands
-- scammers impersonate now. The reddit-brands-discover cron (weekly) aggregates
-- those mentions, resolves them through the v174 alias layer, drops the
-- already-watched ones, and writes the remainder here for a human to review
-- and (manually) promote. This table is the review queue + Telegram digest
-- source — it never auto-mutates the monitored set.
--
-- Modelled on shopfront_clone_alerts (v140): a real mutable review row with a
-- status lifecycle + service_role-only RLS.

CREATE TABLE IF NOT EXISTS public.reddit_watchlist_candidates (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Canonical join key (brand_normalize of the raw mention). Unique so the
  -- cron upserts mention_count rather than duplicating a brand.
  brand_normalized   TEXT NOT NULL UNIQUE,
  -- A representative raw mention string (for human readability in the queue).
  raw_brand          TEXT NOT NULL,
  -- How many Reddit posts named this brand in the aggregation window.
  mention_count      INTEGER NOT NULL DEFAULT 0,
  -- Canonical brand from the v174 alias layer, or NULL when unknown. NULL is
  -- the interesting case: an impersonated brand with no canonical match is a
  -- genuine new watchlist candidate.
  resolved_canonical TEXT,
  source             TEXT NOT NULL DEFAULT 'reddit',
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pending-queue lookups for the admin/Telegram review.
CREATE INDEX IF NOT EXISTS idx_rwc_pending
  ON public.reddit_watchlist_candidates (mention_count DESC, last_seen_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.reddit_watchlist_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reddit_watchlist_candidates_service_role_all
  ON public.reddit_watchlist_candidates;
CREATE POLICY reddit_watchlist_candidates_service_role_all
  ON public.reddit_watchlist_candidates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Status-preserving upsert: refresh mention_count / raw_brand / canonical /
-- last_seen_at on re-detection, but NEVER reset `status` (so a 'dismissed' or
-- 'reviewed' candidate doesn't reappear as 'pending' next week).
CREATE OR REPLACE FUNCTION upsert_reddit_watchlist_candidate(
  p_brand_normalized TEXT,
  p_raw_brand TEXT,
  p_mention_count INT,
  p_resolved_canonical TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  INSERT INTO public.reddit_watchlist_candidates
    (brand_normalized, raw_brand, mention_count, resolved_canonical)
  VALUES
    (p_brand_normalized, p_raw_brand, p_mention_count, p_resolved_canonical)
  ON CONFLICT (brand_normalized) DO UPDATE SET
    mention_count      = EXCLUDED.mention_count,
    raw_brand          = EXCLUDED.raw_brand,
    resolved_canonical = EXCLUDED.resolved_canonical,
    last_seen_at       = NOW();
$$;

-- Supabase auto-grants EXECUTE to PUBLIC on every CREATE FUNCTION — revoke the
-- lot, grant only service_role (the cron's client). See feedback memory on
-- REVOKE needing PUBLIC, not just anon+authenticated.
REVOKE EXECUTE ON FUNCTION
  upsert_reddit_watchlist_candidate(TEXT, TEXT, INT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  upsert_reddit_watchlist_candidate(TEXT, TEXT, INT, TEXT)
  TO service_role;
