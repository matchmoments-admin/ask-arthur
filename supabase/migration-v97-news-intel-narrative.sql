-- v97 — News-style intel sources: narrative columns on feed_items + ETag cache.
--
-- Why: pipeline/scrapers/{acsc_alerts,asic_investor_alerts,scamwatch_alerts}.py
-- write regulator/news narratives to feed_items (same table reddit narratives
-- live in). Existing columns cover most fields; add the few missing ones plus
-- a 1024-dim Voyage embedding so feed-items-embed.ts can mirror the Reddit
-- pattern (search via match_scam_reports + hybrid retrieval).
--
-- Also adds feed_http_cache so RSS scrapers can send If-Modified-Since/ETag
-- and short-circuit on 304 — slashes bandwidth for the no-op runs that make
-- up most of the cron.
--
-- Idempotent: every ALTER uses IF NOT EXISTS. Re-applying is safe.

-- ── 1. Narrative + embedding columns on feed_items ────────────────────────

ALTER TABLE public.feed_items
  ADD COLUMN IF NOT EXISTS body_md TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[],
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_r2_key TEXT,
  ADD COLUMN IF NOT EXISTS embedding vector(1024),
  ADD COLUMN IF NOT EXISTS embedding_model_version TEXT;

COMMENT ON COLUMN public.feed_items.body_md IS
  'Article body in Markdown — populated by news-style scrapers (acsc, scamwatch). Reddit narratives leave this null.';
COMMENT ON COLUMN public.feed_items.tags IS
  'Source-supplied taxonomy: RSS categories, Drupal keywords, ASIC entity-type flags. Searchable via GIN.';
COMMENT ON COLUMN public.feed_items.published_at IS
  'Publication timestamp from the source. Distinct from source_created_at on Reddit (which is post creation time).';
COMMENT ON COLUMN public.feed_items.evidence_r2_key IS
  'R2 key for the og:image / hero image snapshot. Format: evidence/{source}/{YYYY-MM-DD}/{slug}.png';
COMMENT ON COLUMN public.feed_items.embedding IS
  'Voyage 3 (1024d) embedding of title+summary+body. NULL until feed-items-embed.ts processes the row.';

-- Source allowlist: add 'acsc', 'asic_investor', 'scamwatch_alert'.
-- Keep existing 'scamwatch' for the deprecated url-only scraper's historical
-- rows so we don't have to rewrite them.
ALTER TABLE public.feed_items DROP CONSTRAINT IF EXISTS feed_items_source_check;
ALTER TABLE public.feed_items ADD CONSTRAINT feed_items_source_check
  CHECK (source = ANY (ARRAY[
    'reddit',
    'user_report',
    'verified_scam',
    'scamwatch',         -- legacy URL-only rows
    'scamwatch_alert',   -- new HTML narrative scraper
    'acsc',              -- ACSC alerts/advisories RSS
    'asic_investor'      -- ASIC Moneysmart Investor Alert List
  ]));

-- Tags GIN index — narrative scrapers will frequently filter by tag for
-- per-channel digests (eg "phishing" tag for the phishing weekly).
CREATE INDEX IF NOT EXISTS idx_feed_items_tags
  ON public.feed_items USING GIN (tags);

-- published_at index for "this week" digest queries.
CREATE INDEX IF NOT EXISTS idx_feed_items_published_at
  ON public.feed_items (published_at DESC NULLS LAST)
  WHERE published_at IS NOT NULL;

-- Partial vector index — only embedded rows. Mirrors the pattern on
-- reddit_post_intel.embedding.
CREATE INDEX IF NOT EXISTS idx_feed_items_embedding
  ON public.feed_items USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding IS NOT NULL;

-- Backfill source for the embed-trigger cron: rows that need embedding.
-- IS NULL filter keeps the index small (a few hundred rows at most before
-- the cron catches up).
CREATE INDEX IF NOT EXISTS idx_feed_items_unembedded_narrative
  ON public.feed_items (created_at DESC)
  WHERE embedding IS NULL
    AND source IN ('scamwatch_alert', 'acsc', 'asic_investor');

-- ── 2. feed_http_cache — ETag/Last-Modified shortcut for RSS scrapers ────

CREATE TABLE IF NOT EXISTS public.feed_http_cache (
  source        TEXT NOT NULL,
  url           TEXT NOT NULL,
  etag          TEXT,
  last_modified TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_code   INTEGER NOT NULL,
  PRIMARY KEY (source, url)
);

COMMENT ON TABLE public.feed_http_cache IS
  'HTTP conditional-request cache for RSS/HTML scrapers. The Python helper '
  'common/http_cache.py reads etag/last_modified, sends them as request '
  'headers, and stores the new values on a 200 response.';

-- Service role only; no consumer access.
ALTER TABLE public.feed_http_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feed_http_cache_service ON public.feed_http_cache;
CREATE POLICY feed_http_cache_service ON public.feed_http_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. RPC for the embed-trigger cron ─────────────────────────────────────
--
-- The cron at /api/cron/feed-items-embed-trigger calls this to find batches
-- of unembedded narrative rows. Wrapping in an RPC lets us evolve the source
-- list without touching the route.

CREATE OR REPLACE FUNCTION public.get_unembedded_narrative_feed_items(
  p_limit INT DEFAULT 40
) RETURNS TABLE (
  id BIGINT,
  source TEXT,
  title TEXT,
  description TEXT,
  body_md TEXT,
  tags TEXT[],
  impersonated_brand TEXT,
  category TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, source, title, description, body_md, tags, impersonated_brand, category
  FROM public.feed_items
  WHERE embedding IS NULL
    AND source IN ('scamwatch_alert', 'acsc', 'asic_investor')
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE ALL ON FUNCTION public.get_unembedded_narrative_feed_items(INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unembedded_narrative_feed_items(INT) TO service_role;

COMMENT ON FUNCTION public.get_unembedded_narrative_feed_items(INT) IS
  'Cron-poller helper for feed-items-embed.ts. Returns up to p_limit unembedded narrative rows.';
