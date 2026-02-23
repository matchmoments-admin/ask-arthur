-- migration-v13: Feed References & Archive Fix
-- Adds source attribution URLs for government tracking/audit,
-- and fixes archive_old_urls default to 180 days.
-- Run in Supabase SQL Editor

-- ══════════════════════════════════════════════
-- Alter: scam_urls — add feed_references JSONB column
-- ══════════════════════════════════════════════

ALTER TABLE scam_urls
  ADD COLUMN IF NOT EXISTS feed_references JSONB DEFAULT '{}';

COMMENT ON COLUMN scam_urls.feed_references IS
  'Source attribution URLs keyed by feed name, e.g. {"urlhaus": "https://urlhaus.abuse.ch/url/12345/", "phishtank": "http://www.phishtank.com/phish_detail.php?phish_id=8765"}. Used for government reporting and audit trail.';

-- ══════════════════════════════════════════════
-- Update: bulk_upsert_feed_url — add 10th param p_feed_reference_url
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bulk_upsert_feed_url(
  p_normalized_url    TEXT,
  p_domain            TEXT,
  p_subdomain         TEXT        DEFAULT NULL,
  p_tld               TEXT        DEFAULT '',
  p_full_path         TEXT        DEFAULT NULL,
  p_feed_source       TEXT        DEFAULT 'unknown',
  p_scam_type         TEXT        DEFAULT NULL,
  p_brand             TEXT        DEFAULT NULL,
  p_feed_reported_at  TIMESTAMPTZ DEFAULT NULL,
  p_feed_reference_url TEXT       DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url_id    BIGINT;
  v_is_new    BOOLEAN;
  v_ref_obj   JSONB;
BEGIN
  -- Build reference JSONB: {"urlhaus": "https://..."} or empty {}
  IF p_feed_reference_url IS NOT NULL THEN
    v_ref_obj := jsonb_build_object(p_feed_source, p_feed_reference_url);
  ELSE
    v_ref_obj := '{}';
  END IF;

  INSERT INTO scam_urls (
    normalized_url, domain, subdomain, tld, full_path,
    source_type, primary_scam_type, brand_impersonated,
    feed_sources, last_seen_in_feed, enrichment_status,
    feed_reported_at, feed_references
  )
  VALUES (
    p_normalized_url, p_domain, p_subdomain, p_tld, p_full_path,
    'feed', p_scam_type, p_brand,
    ARRAY[p_feed_source], NOW(), 'pending',
    p_feed_reported_at, v_ref_obj
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
    -- Keep the earliest feed_reported_at across all feeds
    feed_reported_at   = LEAST(scam_urls.feed_reported_at, EXCLUDED.feed_reported_at),
    -- Merge feed references (new keys override, existing keys preserved)
    feed_references    = COALESCE(scam_urls.feed_references, '{}') || v_ref_obj,
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
-- Fix: archive_old_urls — update default from 90 to 180 days
-- (v12 may have been applied with the old 90-day default)
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION archive_old_urls(p_archive_days INT DEFAULT 180)
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
    AND feed_reported_at IS NOT NULL
    AND feed_reported_at < NOW() - (p_archive_days || ' days')::INTERVAL
    -- Only archive if not recently re-confirmed active by a feed
    AND (last_seen_in_feed IS NULL OR last_seen_in_feed < NOW() - INTERVAL '7 days')
    -- Preserve community-validated URLs (3+ unique reporters)
    AND unique_reporter_count < 3
    -- Preserve high-confidence URLs from Claude analysis
    AND confidence_level NOT IN ('high', 'confirmed');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'archived_count', v_count,
    'archive_days', p_archive_days
  );
END;
$$;
