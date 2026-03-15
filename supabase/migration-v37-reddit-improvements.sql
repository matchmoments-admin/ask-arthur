-- Migration v37: Reddit scraper improvements
-- 1. Add feed columns to scam_entities (match scam_urls/scam_crypto_wallets pattern)
-- 2. Replace bulk_upsert_feed_entity() RPC with expanded 6-param version
-- 3. Create reddit_processed_posts table for cross-run deduplication

-- =============================================================================
-- 1a. Add feed columns to scam_entities
-- =============================================================================
ALTER TABLE scam_entities
  ADD COLUMN IF NOT EXISTS feed_sources       TEXT[]       DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_seen_in_feed  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feed_reported_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feed_references    JSONB        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evidence_r2_key    TEXT;

-- Indexes for feed queries
CREATE INDEX IF NOT EXISTS idx_scam_entities_feed_sources
  ON scam_entities USING GIN (feed_sources);
CREATE INDEX IF NOT EXISTS idx_scam_entities_feed_reported_at
  ON scam_entities (feed_reported_at)
  WHERE feed_reported_at IS NOT NULL;

-- =============================================================================
-- 1b. Replace bulk_upsert_feed_entity() with 6-param version
--     Now accepts feed_reported_at + evidence_r2_key, mirrors URL/wallet pattern.
-- =============================================================================
CREATE OR REPLACE FUNCTION bulk_upsert_feed_entity(
  p_entity_type        TEXT,
  p_normalized_value   TEXT,
  p_feed_source        TEXT DEFAULT 'unknown',
  p_feed_reference_url TEXT DEFAULT NULL,
  p_feed_reported_at   TIMESTAMPTZ DEFAULT NULL,
  p_evidence_r2_key    TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id      BIGINT;
  v_is_new  BOOLEAN;
  v_ref_obj JSONB;
BEGIN
  -- Build reference object from feed source + URL
  IF p_feed_reference_url IS NOT NULL THEN
    v_ref_obj := jsonb_build_object(p_feed_source, p_feed_reference_url);
  ELSE
    v_ref_obj := '{}'::jsonb;
  END IF;

  INSERT INTO scam_entities (
    entity_type, normalized_value, raw_value,
    feed_sources, feed_reported_at, feed_references,
    evidence_r2_key, last_seen_in_feed
  )
  VALUES (
    p_entity_type, p_normalized_value, p_normalized_value,
    ARRAY[p_feed_source], p_feed_reported_at, v_ref_obj,
    p_evidence_r2_key, NOW()
  )
  ON CONFLICT (entity_type, normalized_value) DO UPDATE SET
    report_count      = scam_entities.report_count + 1,
    last_seen         = NOW(),
    last_seen_in_feed = NOW(),
    feed_sources      = CASE
                          WHEN p_feed_source = ANY(scam_entities.feed_sources)
                          THEN scam_entities.feed_sources
                          ELSE array_append(scam_entities.feed_sources, p_feed_source)
                        END,
    feed_reported_at  = LEAST(scam_entities.feed_reported_at, p_feed_reported_at),
    feed_references   = scam_entities.feed_references || v_ref_obj,
    evidence_r2_key   = COALESCE(scam_entities.evidence_r2_key, p_evidence_r2_key)
  RETURNING id, (xmax = 0) INTO v_id, v_is_new;

  RETURN json_build_object('entity_id', v_id, 'is_new', v_is_new);
END;
$$;

-- =============================================================================
-- 1c. Reddit processed posts table for cross-run deduplication
-- =============================================================================
CREATE TABLE IF NOT EXISTS reddit_processed_posts (
  post_id       TEXT        PRIMARY KEY,
  subreddit     TEXT        NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_reddit_processed_posts_processed_at
  ON reddit_processed_posts (processed_at);

-- RLS: service role only
ALTER TABLE reddit_processed_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on reddit_processed_posts"
  ON reddit_processed_posts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Cleanup RPC: delete processed posts older than N days
CREATE OR REPLACE FUNCTION cleanup_old_reddit_posts(p_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM reddit_processed_posts
  WHERE processed_at < NOW() - (p_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
