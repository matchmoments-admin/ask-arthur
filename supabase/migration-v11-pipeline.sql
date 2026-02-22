-- migration-v11: Scam Data Pipeline — Feed Ingestion & Enrichment
-- Adds feed-sourced URL columns, ingestion log, and pipeline functions
-- Run in Supabase SQL Editor

-- ══════════════════════════════════════════════
-- Alter: scam_urls — add feed pipeline columns
-- ══════════════════════════════════════════════

ALTER TABLE scam_urls
  ADD COLUMN IF NOT EXISTS feed_sources          TEXT[]       DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_seen_in_feed     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staleness_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_status     TEXT         DEFAULT 'skipped'
    CHECK (enrichment_status IN ('pending', 'completed', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS enrichment_attempted_at TIMESTAMPTZ;

-- Staleness index: active URLs ordered by last_seen_in_feed for the staleness cron
CREATE INDEX IF NOT EXISTS idx_scam_urls_staleness
  ON scam_urls (last_seen_in_feed)
  WHERE is_active = TRUE AND last_seen_in_feed IS NOT NULL;

-- Enrichment queue: pending URLs that need WHOIS+SSL enrichment
CREATE INDEX IF NOT EXISTS idx_scam_urls_enrichment_queue
  ON scam_urls (enrichment_status, created_at)
  WHERE enrichment_status = 'pending' AND is_active = TRUE;

-- GIN index on feed_sources for array containment queries
CREATE INDEX IF NOT EXISTS idx_scam_urls_feed_sources
  ON scam_urls USING GIN (feed_sources);

-- ══════════════════════════════════════════════
-- Table: feed_ingestion_log — observability for each scraper run
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS feed_ingestion_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed_name       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  urls_fetched    INT DEFAULT 0,
  urls_new        INT DEFAULT 0,
  urls_updated    INT DEFAULT 0,
  urls_skipped    INT DEFAULT 0,
  duration_ms     INT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_ingestion_log_feed
  ON feed_ingestion_log (feed_name, created_at DESC);

-- RLS for feed_ingestion_log — service role only
ALTER TABLE feed_ingestion_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can select feed log"
  ON feed_ingestion_log FOR SELECT USING (true);
CREATE POLICY "Service role can insert feed log"
  ON feed_ingestion_log FOR INSERT WITH CHECK (true);

-- ══════════════════════════════════════════════
-- Function: bulk_upsert_feed_url
-- Lightweight upsert for feed-sourced URLs (no reporter tracking).
-- Appends feed source, updates last_seen_in_feed,
-- sets enrichment_status = 'pending' for new URLs,
-- reactivates stale URLs if seen again.
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bulk_upsert_feed_url(
  p_normalized_url  TEXT,
  p_domain          TEXT,
  p_subdomain       TEXT      DEFAULT NULL,
  p_tld             TEXT      DEFAULT '',
  p_full_path       TEXT      DEFAULT NULL,
  p_feed_source     TEXT      DEFAULT 'unknown',
  p_scam_type       TEXT      DEFAULT NULL,
  p_brand           TEXT      DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url_id    BIGINT;
  v_is_new    BOOLEAN;
  v_was_stale BOOLEAN := FALSE;
BEGIN
  INSERT INTO scam_urls (
    normalized_url, domain, subdomain, tld, full_path,
    source_type, primary_scam_type, brand_impersonated,
    feed_sources, last_seen_in_feed, enrichment_status
  )
  VALUES (
    p_normalized_url, p_domain, p_subdomain, p_tld, p_full_path,
    'feed', p_scam_type, p_brand,
    ARRAY[p_feed_source], NOW(), 'pending'
  )
  ON CONFLICT (normalized_url) DO UPDATE SET
    report_count       = scam_urls.report_count + 1,
    last_reported_at   = NOW(),
    last_seen_in_feed  = NOW(),
    -- Append feed source if not already present
    feed_sources       = CASE
      WHEN p_feed_source = ANY(scam_urls.feed_sources) THEN scam_urls.feed_sources
      ELSE array_append(scam_urls.feed_sources, p_feed_source)
    END,
    -- Only override scam type/brand if not already set
    primary_scam_type  = COALESCE(scam_urls.primary_scam_type, EXCLUDED.primary_scam_type),
    brand_impersonated = COALESCE(scam_urls.brand_impersonated, EXCLUDED.brand_impersonated),
    -- Reactivate stale URLs
    is_active          = TRUE
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_url_id, v_is_new;

  RETURN json_build_object(
    'scam_url_id', v_url_id,
    'is_new', v_is_new
  );
END;
$$;

-- ══════════════════════════════════════════════
-- Function: mark_stale_urls
-- Deactivates URLs not seen in any feed for N days.
-- Preserves:
--   - Community-validated URLs with 3+ unique reporters
--   - HIGH_RISK URLs (confidence_level 'high' or 'confirmed')
--     from Claude analysis regardless of reporter count
-- Returns count of deactivated URLs.
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION mark_stale_urls(p_stale_days INT DEFAULT 7)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE scam_urls
  SET
    is_active = FALSE,
    staleness_checked_at = NOW()
  WHERE
    is_active = TRUE
    AND last_seen_in_feed IS NOT NULL
    AND last_seen_in_feed < NOW() - (p_stale_days || ' days')::INTERVAL
    -- Preserve community-validated URLs (3+ unique reporters)
    AND unique_reporter_count < 3
    -- Preserve high-confidence URLs from Claude analysis
    AND confidence_level NOT IN ('high', 'confirmed');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days
  );
END;
$$;
