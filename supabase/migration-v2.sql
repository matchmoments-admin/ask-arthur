-- Ask Arthur v2 Migration
-- Run after initial schema is in place

-- ============================================================
-- 1. Add screenshot_key to verified_scams (WS3: R2 integration)
-- ============================================================
ALTER TABLE verified_scams ADD COLUMN IF NOT EXISTS screenshot_key TEXT;

-- ============================================================
-- 2. Blog posts table (WS2: Content engine)
-- ============================================================
CREATE TABLE IF NOT EXISTS blog_posts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Arthur AI',
  tags JSONB NOT NULL DEFAULT '[]',
  published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: Public can read published posts, service role manages all
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published blog posts"
  ON blog_posts FOR SELECT
  USING (published = TRUE);

CREATE POLICY "Service role manages blog posts"
  ON blog_posts FOR ALL
  USING (auth.role() = 'service_role');

-- Index for slug lookups and published ordering
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts (slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts (published, published_at DESC);

-- ============================================================
-- 3. API keys table (WS4: B2B Threat API)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  org_name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  daily_limit INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages API keys"
  ON api_keys FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
