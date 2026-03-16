-- migration-v43-country-codes.sql
-- Add country_code (ISO 3166-1 alpha-2) to threat intel tables for regional attribution.
-- Reddit posts self-tag [US], [UK], [AU]; CERT AU / Scamwatch / crt.sh are inherently AU.

BEGIN;

-- ============================================================
-- 1. DDL — add country_code column to 3 tables
-- ============================================================

ALTER TABLE scam_urls ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE scam_entities ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE scam_crypto_wallets ADD COLUMN IF NOT EXISTS country_code TEXT;

-- Partial indexes — sparse column, only index non-NULL rows
CREATE INDEX IF NOT EXISTS idx_scam_urls_country_code
  ON scam_urls (country_code) WHERE country_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scam_entities_country_code
  ON scam_entities (country_code) WHERE country_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scam_crypto_wallets_country_code
  ON scam_crypto_wallets (country_code) WHERE country_code IS NOT NULL;

-- ============================================================
-- 2. Update bulk_upsert_feed_url — 10 → 11 params
-- ============================================================

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
  p_feed_reference_url TEXT       DEFAULT NULL,
  p_country_code      TEXT        DEFAULT NULL
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
  IF p_feed_reference_url IS NOT NULL THEN
    v_ref_obj := jsonb_build_object(p_feed_source, p_feed_reference_url);
  ELSE
    v_ref_obj := '{}';
  END IF;

  INSERT INTO scam_urls (
    normalized_url, domain, subdomain, tld, full_path,
    source_type, primary_scam_type, brand_impersonated,
    feed_sources, last_seen_in_feed, enrichment_status,
    feed_reported_at, feed_references, country_code
  )
  VALUES (
    p_normalized_url, p_domain, p_subdomain, p_tld, p_full_path,
    'feed', p_scam_type, p_brand,
    ARRAY[p_feed_source], NOW(), 'pending',
    p_feed_reported_at, v_ref_obj, p_country_code
  )
  ON CONFLICT (normalized_url) DO UPDATE SET
    report_count       = scam_urls.report_count + 1,
    last_reported_at   = NOW(),
    last_seen_in_feed  = NOW(),
    feed_sources       = CASE
      WHEN p_feed_source = ANY(scam_urls.feed_sources) THEN scam_urls.feed_sources
      ELSE array_append(scam_urls.feed_sources, p_feed_source)
    END,
    primary_scam_type  = COALESCE(scam_urls.primary_scam_type, EXCLUDED.primary_scam_type),
    brand_impersonated = COALESCE(scam_urls.brand_impersonated, EXCLUDED.brand_impersonated),
    feed_reported_at   = LEAST(scam_urls.feed_reported_at, EXCLUDED.feed_reported_at),
    feed_references    = COALESCE(scam_urls.feed_references, '{}') || v_ref_obj,
    is_active          = TRUE,
    -- First country wins — don't overwrite existing
    country_code       = COALESCE(scam_urls.country_code, EXCLUDED.country_code)
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_url_id, v_is_new;

  RETURN json_build_object(
    'scam_url_id', v_url_id,
    'is_new', v_is_new
  );
END;
$$;

-- ============================================================
-- 3. Update bulk_upsert_feed_entity — 6 → 7 params
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_upsert_feed_entity(
  p_entity_type        TEXT,
  p_normalized_value   TEXT,
  p_feed_source        TEXT DEFAULT 'unknown',
  p_feed_reference_url TEXT DEFAULT NULL,
  p_feed_reported_at   TIMESTAMPTZ DEFAULT NULL,
  p_evidence_r2_key    TEXT DEFAULT NULL,
  p_country_code       TEXT DEFAULT NULL
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
  IF p_feed_reference_url IS NOT NULL THEN
    v_ref_obj := jsonb_build_object(p_feed_source, p_feed_reference_url);
  ELSE
    v_ref_obj := '{}'::jsonb;
  END IF;

  INSERT INTO scam_entities (
    entity_type, normalized_value, raw_value,
    feed_sources, feed_reported_at, feed_references,
    evidence_r2_key, last_seen_in_feed, country_code
  )
  VALUES (
    p_entity_type, p_normalized_value, p_normalized_value,
    ARRAY[p_feed_source], p_feed_reported_at, v_ref_obj,
    p_evidence_r2_key, NOW(), p_country_code
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
    evidence_r2_key   = COALESCE(scam_entities.evidence_r2_key, p_evidence_r2_key),
    country_code      = COALESCE(scam_entities.country_code, EXCLUDED.country_code)
  RETURNING id, (xmax = 0) INTO v_id, v_is_new;

  RETURN json_build_object('entity_id', v_id, 'is_new', v_is_new);
END;
$$;

-- ============================================================
-- 4. Update bulk_upsert_feed_crypto_wallet — 8 → 9 params
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_upsert_feed_crypto_wallet(
  p_address            TEXT,
  p_chain              TEXT,
  p_associated_url     TEXT         DEFAULT NULL,
  p_associated_domain  TEXT         DEFAULT NULL,
  p_scam_type          TEXT         DEFAULT NULL,
  p_feed_source        TEXT         DEFAULT 'unknown',
  p_feed_reported_at   TIMESTAMPTZ  DEFAULT NULL,
  p_feed_reference_url TEXT         DEFAULT NULL,
  p_country_code       TEXT         DEFAULT NULL
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
  IF p_feed_reference_url IS NOT NULL THEN
    v_ref_obj := jsonb_build_object(p_feed_source, p_feed_reference_url);
  ELSE
    v_ref_obj := '{}';
  END IF;

  INSERT INTO scam_crypto_wallets (
    address, chain, associated_url, associated_domain, scam_type,
    feed_sources, last_seen_in_feed, feed_reported_at, feed_references,
    country_code
  )
  VALUES (
    p_address, p_chain, p_associated_url, p_associated_domain, p_scam_type,
    ARRAY[p_feed_source], NOW(), p_feed_reported_at, v_ref_obj,
    p_country_code
  )
  ON CONFLICT (address) DO UPDATE SET
    last_seen_in_feed  = NOW(),
    feed_sources       = CASE
      WHEN p_feed_source = ANY(scam_crypto_wallets.feed_sources) THEN scam_crypto_wallets.feed_sources
      ELSE array_append(scam_crypto_wallets.feed_sources, p_feed_source)
    END,
    scam_type          = COALESCE(scam_crypto_wallets.scam_type, p_scam_type),
    associated_url     = COALESCE(scam_crypto_wallets.associated_url, p_associated_url),
    associated_domain  = COALESCE(scam_crypto_wallets.associated_domain, p_associated_domain),
    feed_reported_at   = LEAST(scam_crypto_wallets.feed_reported_at, EXCLUDED.feed_reported_at),
    feed_references    = COALESCE(scam_crypto_wallets.feed_references, '{}') || v_ref_obj,
    is_active          = TRUE,
    country_code       = COALESCE(scam_crypto_wallets.country_code, EXCLUDED.country_code)
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_wallet_id, v_is_new;

  RETURN json_build_object(
    'scam_wallet_id', v_wallet_id,
    'is_new', v_is_new
  );
END;
$$;

-- ============================================================
-- 5. Update threat_intel_urls view — add country_code
-- ============================================================

CREATE OR REPLACE VIEW threat_intel_urls AS
SELECT
  su.id               AS url_id,
  su.normalized_url,
  su.domain,
  su.subdomain,
  su.tld,
  su.full_path,
  su.report_count,
  su.unique_reporter_count,
  su.confidence_score,
  su.confidence_level,
  su.primary_scam_type,
  su.brand_impersonated,
  su.google_safe_browsing,
  su.virustotal_malicious,
  su.virustotal_score,
  su.whois_registrar,
  su.whois_registrant_country,
  su.whois_created_date,
  su.whois_is_private,
  su.ssl_valid,
  su.ssl_issuer,
  su.ssl_days_remaining,
  su.feed_sources,
  su.first_reported_at,
  su.last_reported_at,
  su.is_active,
  su.country_code
FROM scam_urls su
WHERE su.is_active = TRUE
  AND (su.confidence_level IN ('high', 'confirmed') OR su.report_count >= 3);

-- ============================================================
-- 6. Backfill AU for known Australian feed sources
-- ============================================================

UPDATE scam_urls SET country_code = 'AU'
WHERE country_code IS NULL
  AND ('cert_au' = ANY(feed_sources) OR 'scamwatch_au' = ANY(feed_sources)
       OR 'crtsh' = ANY(feed_sources) OR 'reddit_rausfinance' = ANY(feed_sources));

UPDATE scam_entities SET country_code = 'AU'
WHERE country_code IS NULL
  AND ('cert_au' = ANY(feed_sources) OR 'scamwatch_au' = ANY(feed_sources)
       OR 'reddit_rausfinance' = ANY(feed_sources));

UPDATE scam_crypto_wallets SET country_code = 'AU'
WHERE country_code IS NULL
  AND ('cert_au' = ANY(feed_sources) OR 'scamwatch_au' = ANY(feed_sources)
       OR 'reddit_rausfinance' = ANY(feed_sources));

COMMIT;
