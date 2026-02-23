-- migration-v14: Threat Intelligence Expansion — IPs & Crypto Wallets
-- Adds scam_ips and scam_crypto_wallets tables, renames feed_ingestion_log
-- columns to be generic, adds bulk upsert RPCs and staleness functions.
-- Run in Supabase SQL Editor

-- ══════════════════════════════════════════════
-- 1a. Rename feed_ingestion_log columns to be generic
-- ══════════════════════════════════════════════

ALTER TABLE feed_ingestion_log
  RENAME COLUMN urls_fetched  TO records_fetched;
ALTER TABLE feed_ingestion_log
  RENAME COLUMN urls_new      TO records_new;
ALTER TABLE feed_ingestion_log
  RENAME COLUMN urls_updated  TO records_updated;
ALTER TABLE feed_ingestion_log
  RENAME COLUMN urls_skipped  TO records_skipped;

ALTER TABLE feed_ingestion_log
  ADD COLUMN IF NOT EXISTS record_type TEXT DEFAULT 'url'
    CHECK (record_type IN ('url', 'ip', 'crypto_wallet'));

-- ══════════════════════════════════════════════
-- 1b. Table: scam_ips — feed-sourced malicious IP addresses
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scam_ips (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_address          INET NOT NULL UNIQUE,
  ip_version          INT,                              -- 4 or 6
  port                INT,
  as_number           INT,
  as_name             TEXT,
  country             TEXT,
  threat_type         TEXT,                             -- botnet_c2, malware, scanner, spam, etc.
  blocklist_count     INT DEFAULT 1,                    -- IPsum cross-reference count
  confidence_score    REAL DEFAULT 0.0,                 -- Computed: blocklist_count / 8, capped at 1.0
  confidence_level    TEXT DEFAULT 'low'
    CHECK (confidence_level IN ('low', 'medium', 'high', 'confirmed')),
  feed_sources        TEXT[]       DEFAULT '{}',
  last_seen_in_feed   TIMESTAMPTZ,
  feed_reported_at    TIMESTAMPTZ,
  feed_references     JSONB        DEFAULT '{}',
  first_seen          TIMESTAMPTZ,                      -- Feodo-specific
  last_online         TIMESTAMPTZ,                      -- Feodo-specific
  is_active           BOOLEAN      DEFAULT TRUE,
  staleness_checked_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

-- Staleness: active IPs ordered by last_seen_in_feed
CREATE INDEX IF NOT EXISTS idx_scam_ips_staleness
  ON scam_ips (last_seen_in_feed)
  WHERE is_active = TRUE AND last_seen_in_feed IS NOT NULL;

-- Confidence: active IPs with high/confirmed confidence
CREATE INDEX IF NOT EXISTS idx_scam_ips_confidence
  ON scam_ips (confidence_level)
  WHERE is_active = TRUE;

-- Country lookup
CREATE INDEX IF NOT EXISTS idx_scam_ips_country
  ON scam_ips (country)
  WHERE country IS NOT NULL;

-- Feed sources array containment
CREATE INDEX IF NOT EXISTS idx_scam_ips_feed_sources
  ON scam_ips USING GIN (feed_sources);

-- ══════════════════════════════════════════════
-- 1c. Table: scam_crypto_wallets — feed-sourced scam wallet addresses
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scam_crypto_wallets (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address             TEXT NOT NULL UNIQUE,
  chain               TEXT NOT NULL
    CHECK (chain IN ('ETH', 'BTC', 'SOL', 'TRON', 'OTHER')),
  associated_url      TEXT,
  associated_domain   TEXT,
  scam_type           TEXT,
  confidence_score    REAL DEFAULT 0.0,
  confidence_level    TEXT DEFAULT 'low'
    CHECK (confidence_level IN ('low', 'medium', 'high', 'confirmed')),
  feed_sources        TEXT[]       DEFAULT '{}',
  last_seen_in_feed   TIMESTAMPTZ,
  feed_reported_at    TIMESTAMPTZ,
  feed_references     JSONB        DEFAULT '{}',
  is_active           BOOLEAN      DEFAULT TRUE,
  staleness_checked_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

-- Chain index
CREATE INDEX IF NOT EXISTS idx_scam_wallets_chain
  ON scam_crypto_wallets (chain);

-- Staleness: active wallets ordered by last_seen_in_feed
CREATE INDEX IF NOT EXISTS idx_scam_wallets_staleness
  ON scam_crypto_wallets (last_seen_in_feed)
  WHERE is_active = TRUE AND last_seen_in_feed IS NOT NULL;

-- Confidence: active wallets with high/confirmed confidence
CREATE INDEX IF NOT EXISTS idx_scam_wallets_confidence
  ON scam_crypto_wallets (confidence_level)
  WHERE is_active = TRUE;

-- Feed sources array containment
CREATE INDEX IF NOT EXISTS idx_scam_wallets_feed_sources
  ON scam_crypto_wallets USING GIN (feed_sources);

-- ══════════════════════════════════════════════
-- 1d. RLS Policies (same pattern as scam_urls in v9)
-- ══════════════════════════════════════════════

ALTER TABLE scam_ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE scam_crypto_wallets ENABLE ROW LEVEL SECURITY;

-- scam_ips: public SELECT, service role full access
CREATE POLICY "Public can select scam ips" ON scam_ips FOR SELECT USING (true);
CREATE POLICY "Service role can insert scam ips" ON scam_ips FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update scam ips" ON scam_ips FOR UPDATE USING (true);
CREATE POLICY "Service role can delete scam ips" ON scam_ips FOR DELETE USING (true);

-- scam_crypto_wallets: public SELECT, service role full access
CREATE POLICY "Public can select scam wallets" ON scam_crypto_wallets FOR SELECT USING (true);
CREATE POLICY "Service role can insert scam wallets" ON scam_crypto_wallets FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update scam wallets" ON scam_crypto_wallets FOR UPDATE USING (true);
CREATE POLICY "Service role can delete scam wallets" ON scam_crypto_wallets FOR DELETE USING (true);

-- ══════════════════════════════════════════════
-- 1e. Function: bulk_upsert_feed_ip
-- Lightweight upsert for feed-sourced IPs.
-- ON CONFLICT: merge feed_sources, take GREATEST blocklist_count,
-- recompute confidence, COALESCE metadata, LEAST feed_reported_at,
-- merge feed_references, reactivate.
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bulk_upsert_feed_ip(
  p_ip_address        INET,
  p_ip_version        INT          DEFAULT NULL,
  p_port              INT          DEFAULT NULL,
  p_as_number         INT          DEFAULT NULL,
  p_as_name           TEXT         DEFAULT NULL,
  p_country           TEXT         DEFAULT NULL,
  p_threat_type       TEXT         DEFAULT NULL,
  p_blocklist_count   INT          DEFAULT 1,
  p_feed_source       TEXT         DEFAULT 'unknown',
  p_feed_reported_at  TIMESTAMPTZ  DEFAULT NULL,
  p_feed_reference_url TEXT        DEFAULT NULL,
  p_first_seen        TIMESTAMPTZ  DEFAULT NULL,
  p_last_online       TIMESTAMPTZ  DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ip_id      BIGINT;
  v_is_new     BOOLEAN;
  v_ref_obj    JSONB;
  v_count      INT;
  v_score      REAL;
  v_level      TEXT;
BEGIN
  -- Build reference JSONB
  IF p_feed_reference_url IS NOT NULL THEN
    v_ref_obj := jsonb_build_object(p_feed_source, p_feed_reference_url);
  ELSE
    v_ref_obj := '{}';
  END IF;

  INSERT INTO scam_ips (
    ip_address, ip_version, port, as_number, as_name, country,
    threat_type, blocklist_count,
    feed_sources, last_seen_in_feed, feed_reported_at, feed_references,
    first_seen, last_online
  )
  VALUES (
    p_ip_address, p_ip_version, p_port, p_as_number, p_as_name, p_country,
    p_threat_type, p_blocklist_count,
    ARRAY[p_feed_source], NOW(), p_feed_reported_at, v_ref_obj,
    p_first_seen, p_last_online
  )
  ON CONFLICT (ip_address) DO UPDATE SET
    last_seen_in_feed  = NOW(),
    -- Append feed source if not already present
    feed_sources       = CASE
      WHEN p_feed_source = ANY(scam_ips.feed_sources) THEN scam_ips.feed_sources
      ELSE array_append(scam_ips.feed_sources, p_feed_source)
    END,
    -- Take the GREATEST blocklist_count (IPsum may update this)
    blocklist_count    = GREATEST(scam_ips.blocklist_count, p_blocklist_count),
    -- COALESCE metadata fields (don't overwrite with NULL)
    port               = COALESCE(p_port, scam_ips.port),
    as_number          = COALESCE(p_as_number, scam_ips.as_number),
    as_name            = COALESCE(p_as_name, scam_ips.as_name),
    country            = COALESCE(p_country, scam_ips.country),
    threat_type        = COALESCE(scam_ips.threat_type, p_threat_type),
    -- Keep the earliest feed_reported_at
    feed_reported_at   = LEAST(scam_ips.feed_reported_at, EXCLUDED.feed_reported_at),
    -- Merge feed references
    feed_references    = COALESCE(scam_ips.feed_references, '{}') || v_ref_obj,
    -- COALESCE Feodo-specific fields
    first_seen         = COALESCE(scam_ips.first_seen, p_first_seen),
    last_online        = COALESCE(p_last_online, scam_ips.last_online),
    -- Reactivate stale IPs
    is_active          = TRUE
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_ip_id, v_is_new;

  -- Recompute confidence from blocklist_count: score = count/8, capped at 1.0
  SELECT blocklist_count FROM scam_ips WHERE id = v_ip_id INTO v_count;
  v_score := LEAST(1.0, v_count::REAL / 8.0);
  v_level := CASE
    WHEN v_score >= 0.8 THEN 'confirmed'
    WHEN v_score >= 0.5 THEN 'high'
    WHEN v_score >= 0.3 THEN 'medium'
    ELSE 'low'
  END;

  UPDATE scam_ips
  SET confidence_score = v_score, confidence_level = v_level
  WHERE id = v_ip_id;

  RETURN json_build_object(
    'scam_ip_id', v_ip_id,
    'is_new', v_is_new
  );
END;
$$;

-- ══════════════════════════════════════════════
-- 1f. Function: bulk_upsert_feed_crypto_wallet
-- Same upsert pattern for crypto wallets.
-- ON CONFLICT: merge feed_sources, COALESCE metadata,
-- merge references, reactivate.
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bulk_upsert_feed_crypto_wallet(
  p_address            TEXT,
  p_chain              TEXT,
  p_associated_url     TEXT         DEFAULT NULL,
  p_associated_domain  TEXT         DEFAULT NULL,
  p_scam_type          TEXT         DEFAULT NULL,
  p_feed_source        TEXT         DEFAULT 'unknown',
  p_feed_reported_at   TIMESTAMPTZ  DEFAULT NULL,
  p_feed_reference_url TEXT         DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet_id  BIGINT;
  v_is_new     BOOLEAN;
  v_ref_obj    JSONB;
BEGIN
  -- Build reference JSONB
  IF p_feed_reference_url IS NOT NULL THEN
    v_ref_obj := jsonb_build_object(p_feed_source, p_feed_reference_url);
  ELSE
    v_ref_obj := '{}';
  END IF;

  INSERT INTO scam_crypto_wallets (
    address, chain, associated_url, associated_domain, scam_type,
    feed_sources, last_seen_in_feed, feed_reported_at, feed_references
  )
  VALUES (
    p_address, p_chain, p_associated_url, p_associated_domain, p_scam_type,
    ARRAY[p_feed_source], NOW(), p_feed_reported_at, v_ref_obj
  )
  ON CONFLICT (address) DO UPDATE SET
    last_seen_in_feed  = NOW(),
    -- Append feed source if not already present
    feed_sources       = CASE
      WHEN p_feed_source = ANY(scam_crypto_wallets.feed_sources) THEN scam_crypto_wallets.feed_sources
      ELSE array_append(scam_crypto_wallets.feed_sources, p_feed_source)
    END,
    -- COALESCE metadata fields
    scam_type          = COALESCE(scam_crypto_wallets.scam_type, p_scam_type),
    associated_url     = COALESCE(scam_crypto_wallets.associated_url, p_associated_url),
    associated_domain  = COALESCE(scam_crypto_wallets.associated_domain, p_associated_domain),
    -- Keep the earliest feed_reported_at
    feed_reported_at   = LEAST(scam_crypto_wallets.feed_reported_at, EXCLUDED.feed_reported_at),
    -- Merge feed references
    feed_references    = COALESCE(scam_crypto_wallets.feed_references, '{}') || v_ref_obj,
    -- Reactivate stale wallets
    is_active          = TRUE
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_wallet_id, v_is_new;

  RETURN json_build_object(
    'scam_wallet_id', v_wallet_id,
    'is_new', v_is_new
  );
END;
$$;

-- ══════════════════════════════════════════════
-- 1g. Staleness functions
-- ══════════════════════════════════════════════

-- IPs rotate quickly — 7 day staleness default
CREATE OR REPLACE FUNCTION mark_stale_ips(p_stale_days INT DEFAULT 7)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE scam_ips
  SET
    is_active = FALSE,
    staleness_checked_at = NOW()
  WHERE
    is_active = TRUE
    AND last_seen_in_feed IS NOT NULL
    AND last_seen_in_feed < NOW() - (p_stale_days || ' days')::INTERVAL
    -- Preserve high-confidence IPs
    AND confidence_level NOT IN ('high', 'confirmed');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days
  );
END;
$$;

-- Wallets are more persistent — 14 day staleness default
CREATE OR REPLACE FUNCTION mark_stale_crypto_wallets(p_stale_days INT DEFAULT 14)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE scam_crypto_wallets
  SET
    is_active = FALSE,
    staleness_checked_at = NOW()
  WHERE
    is_active = TRUE
    AND last_seen_in_feed IS NOT NULL
    AND last_seen_in_feed < NOW() - (p_stale_days || ' days')::INTERVAL
    -- Preserve high-confidence wallets
    AND confidence_level NOT IN ('high', 'confirmed');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days
  );
END;
$$;
