-- ============================================================
-- v44: Scam Feed — Public Threat Intelligence Feed
-- ============================================================
-- Creates the feed_items table for a unified, browsable scam feed.
-- Sources: Reddit scraper, verified_scams (Claude), user reports.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Create feed_items table
-- ============================================================

CREATE TABLE feed_items (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source            TEXT NOT NULL CHECK (source IN ('reddit', 'user_report', 'verified_scam', 'scamwatch')),
  external_id       TEXT,                          -- Reddit post ID, verified_scam ID, report ID
  title             TEXT NOT NULL,
  description       TEXT,                          -- PII-scrubbed, max ~500 chars
  url               TEXT,                          -- Scam URL mentioned
  source_url        TEXT,                          -- Link back to Reddit post / original
  category          TEXT CHECK (category IN (
                      'phishing', 'romance_scam', 'investment_fraud',
                      'tech_support', 'impersonation', 'shopping_scam',
                      'phone_scam', 'email_scam', 'sms_scam',
                      'employment_scam', 'advance_fee', 'rental_scam',
                      'sextortion', 'informational', 'other'
                    )),
  channel           TEXT,                          -- phone, email, sms, social_media, website
  r2_image_key      TEXT,                          -- R2 object key (user submissions)
  reddit_image_url  TEXT,                          -- Reddit preview image (external)
  has_image         BOOLEAN GENERATED ALWAYS AS (
                      r2_image_key IS NOT NULL OR reddit_image_url IS NOT NULL
                    ) STORED,
  impersonated_brand TEXT,
  country_code      TEXT,                          -- ISO 3166-1 alpha-2
  upvotes           INT DEFAULT 0,
  verified          BOOLEAN DEFAULT FALSE,
  published         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  source_created_at TIMESTAMPTZ                    -- When original post/report was created
);

-- ============================================================
-- 2. Indexes
-- ============================================================

-- Main sort order
CREATE INDEX idx_feed_items_created ON feed_items (source_created_at DESC);

-- Filter indexes
CREATE INDEX idx_feed_items_source ON feed_items (source);
CREATE INDEX idx_feed_items_category ON feed_items (category);
CREATE INDEX idx_feed_items_country ON feed_items (country_code) WHERE country_code IS NOT NULL;

-- Published filter (most queries filter on this)
CREATE INDEX idx_feed_items_published ON feed_items (published) WHERE published = TRUE;

-- Dedup: one feed_item per source+external_id
CREATE UNIQUE INDEX idx_feed_items_external ON feed_items (source, external_id) WHERE external_id IS NOT NULL;

-- Full-text search
CREATE INDEX idx_feed_items_fts ON feed_items
  USING GIN (to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- ============================================================
-- 3. Row-Level Security
-- ============================================================

ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;

-- Public read: anyone can see published items
CREATE POLICY "feed_items_public_read"
  ON feed_items FOR SELECT
  USING (published = TRUE);

-- Service role: full access (bypasses RLS by default, but explicit for clarity)
CREATE POLICY "feed_items_service_all"
  ON feed_items FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 4. Upsert RPC — single-row upsert on (source, external_id)
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_feed_item(
  p_source            TEXT,
  p_external_id       TEXT,
  p_title             TEXT,
  p_description       TEXT      DEFAULT NULL,
  p_url               TEXT      DEFAULT NULL,
  p_source_url        TEXT      DEFAULT NULL,
  p_category          TEXT      DEFAULT NULL,
  p_channel           TEXT      DEFAULT NULL,
  p_r2_image_key      TEXT      DEFAULT NULL,
  p_reddit_image_url  TEXT      DEFAULT NULL,
  p_impersonated_brand TEXT     DEFAULT NULL,
  p_country_code      TEXT      DEFAULT NULL,
  p_upvotes           INT       DEFAULT 0,
  p_verified          BOOLEAN   DEFAULT FALSE,
  p_source_created_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id      BIGINT;
  v_is_new  BOOLEAN;
BEGIN
  INSERT INTO feed_items (
    source, external_id, title, description, url, source_url,
    category, channel, r2_image_key, reddit_image_url,
    impersonated_brand, country_code, upvotes, verified, source_created_at
  )
  VALUES (
    p_source, p_external_id, p_title, p_description, p_url, p_source_url,
    p_category, p_channel, p_r2_image_key, p_reddit_image_url,
    p_impersonated_brand, p_country_code, p_upvotes, p_verified, p_source_created_at
  )
  ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
    upvotes           = EXCLUDED.upvotes,
    description       = COALESCE(EXCLUDED.description, feed_items.description),
    reddit_image_url  = COALESCE(EXCLUDED.reddit_image_url, feed_items.reddit_image_url),
    r2_image_key      = COALESCE(EXCLUDED.r2_image_key, feed_items.r2_image_key),
    category          = COALESCE(EXCLUDED.category, feed_items.category),
    impersonated_brand = COALESCE(EXCLUDED.impersonated_brand, feed_items.impersonated_brand),
    country_code      = COALESCE(feed_items.country_code, EXCLUDED.country_code)
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_id, v_is_new;

  RETURN json_build_object(
    'feed_item_id', v_id,
    'is_new', v_is_new
  );
END;
$$;

COMMIT;
