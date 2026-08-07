-- v266: conditional DO UPDATE on the two hottest write paths — Tier 2 item 6
-- (wayfinder #903; enterprise-review P1).
--
-- WHY. bulk_upsert_feed_url ran an unconditional DO UPDATE on 74.6M calls
-- (HOT ratio 0.43%) — ~78% of the database's dirty-page IO was rewriting
-- rows with no new information, because `report_count + 1` and two NOW()
-- stamps made every re-sighting a full row rewrite. 3h-tier feeds re-list
-- the same URLs up to 8x/day. bulk_upsert_feed_ip (the #2 IO consumer)
-- shares the shape via its unconditional last_seen_in_feed = NOW().
--
-- THE GUARD. DO UPDATE ... WHERE limits rewrites to sightings that carry
-- information:
--   * freshness touch at 20-hour granularity — lossless for every consumer:
--     mark_stale_urls' gate is 7 DAYS, and daily-tier feeds (24h spacing)
--     still touch on every run;
--   * every STATE TRANSITION stays immediate: reactivation, a new feed
--     source joining, first-fill of scam_type/brand/country/threat metadata,
--     an earlier feed_reported_at, a new per-source reference, a higher
--     blocklist_count, a newer last_online.
--
-- SEMANTIC CHANGE, deliberate: for feed URLs, report_count now increments at
-- most ~once/20h per row ("days seen") instead of once per cron sighting
-- ("crons seen"). All feeds dampen equally, so relative ordering in
-- trending/lookup consumers is preserved; absolute values stop inflating 8x
-- on 3h-tier feeds.
--
-- THE RETURNING TRAP (called out by the review): a WHERE-suppressed update
-- returns no row, so RETURNING ... INTO leaves NULLs. Both functions now
-- fall back to a SELECT and return {"unchanged": true}; the Python caller
-- counts those as records_skipped (previously always "updated").
--
-- NOT DONE ON PURPOSE: dropping idx_scam_urls_staleness to chase HOT
-- updates — the review verified it covers a rewritten column AND is
-- genuinely used (368 scans).
--
-- Only the hot overloads change: bulk_upsert_feed_url(...11 args) — the
-- execute_values path in pipeline/scrapers/common/db.py — and
-- bulk_upsert_feed_ip(...13 args). Legacy 8/9/10-arg URL overloads are
-- untouched (no live callers; kept for replay safety).
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.bulk_upsert_feed_url(
  p_normalized_url text,
  p_domain text,
  p_subdomain text DEFAULT NULL::text,
  p_tld text DEFAULT ''::text,
  p_full_path text DEFAULT NULL::text,
  p_feed_source text DEFAULT 'unknown'::text,
  p_scam_type text DEFAULT NULL::text,
  p_brand text DEFAULT NULL::text,
  p_feed_reported_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_feed_reference_url text DEFAULT NULL::text,
  p_country_code text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    country_code       = COALESCE(scam_urls.country_code, EXCLUDED.country_code)
  WHERE
    -- Rewrite only when this sighting carries information:
    scam_urls.last_seen_in_feed IS NULL
    OR scam_urls.last_seen_in_feed < NOW() - INTERVAL '20 hours'
    OR scam_urls.is_active IS DISTINCT FROM TRUE
    OR NOT (p_feed_source = ANY(scam_urls.feed_sources))
    OR (scam_urls.primary_scam_type IS NULL AND EXCLUDED.primary_scam_type IS NOT NULL)
    OR (scam_urls.brand_impersonated IS NULL AND EXCLUDED.brand_impersonated IS NOT NULL)
    OR (scam_urls.country_code IS NULL AND EXCLUDED.country_code IS NOT NULL)
    OR (EXCLUDED.feed_reported_at IS NOT NULL
        AND (scam_urls.feed_reported_at IS NULL
             OR EXCLUDED.feed_reported_at < scam_urls.feed_reported_at))
    OR (p_feed_reference_url IS NOT NULL
        AND NOT (COALESCE(scam_urls.feed_references, '{}') ? p_feed_source))
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_url_id, v_is_new;

  -- WHERE-suppressed conflict: the row exists and needed nothing. Look it up
  -- so callers still get the id, and tell them nothing was written.
  IF v_url_id IS NULL THEN
    SELECT id INTO v_url_id FROM scam_urls WHERE normalized_url = p_normalized_url;
    RETURN json_build_object(
      'scam_url_id', v_url_id,
      'is_new', FALSE,
      'unchanged', TRUE
    );
  END IF;

  RETURN json_build_object(
    'scam_url_id', v_url_id,
    'is_new', v_is_new
  );
END;
$function$;

-- bulk_upsert_feed_ip: signature matches the live 13-arg function EXACTLY
-- (diffed against pg_get_functiondef before writing — the first draft of this
-- migration invented a different signature, which CREATE OR REPLACE would have
-- silently turned into a NEW overload).
--
-- Additional win found in the live source during review: the function ran a
-- SECOND unconditional UPDATE after every upsert to recompute
-- confidence_score/confidence_level from blocklist_count — two full row
-- rewrites per sighting. The recompute is now folded INTO the main DO UPDATE
-- (and the INSERT), so an information-carrying sighting writes once and an
-- uninformative one writes zero times. score = LEAST(1.0, count/8.0),
-- level thresholds unchanged (0.8/0.5/0.3).
CREATE OR REPLACE FUNCTION public.bulk_upsert_feed_ip(
  p_ip_address inet,
  p_ip_version integer DEFAULT NULL::integer,
  p_port integer DEFAULT NULL::integer,
  p_as_number integer DEFAULT NULL::integer,
  p_as_name text DEFAULT NULL::text,
  p_country text DEFAULT NULL::text,
  p_threat_type text DEFAULT NULL::text,
  p_blocklist_count integer DEFAULT 1,
  p_feed_source text DEFAULT 'unknown'::text,
  p_feed_reported_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_feed_reference_url text DEFAULT NULL::text,
  p_first_seen timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_last_online timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_ip_id     BIGINT;
  v_is_new    BOOLEAN;
  v_ref_obj   JSONB;
BEGIN
  IF p_feed_reference_url IS NOT NULL THEN
    v_ref_obj := jsonb_build_object(p_feed_source, p_feed_reference_url);
  ELSE
    v_ref_obj := '{}';
  END IF;

  INSERT INTO scam_ips (
    ip_address, ip_version, port, as_number, as_name, country,
    threat_type, blocklist_count,
    feed_sources, last_seen_in_feed, feed_reported_at, feed_references,
    first_seen, last_online,
    confidence_score, confidence_level
  )
  VALUES (
    p_ip_address, p_ip_version, p_port, p_as_number, p_as_name, p_country,
    p_threat_type, p_blocklist_count,
    ARRAY[p_feed_source], NOW(), p_feed_reported_at, v_ref_obj,
    p_first_seen, p_last_online,
    LEAST(1.0, p_blocklist_count::REAL / 8.0),
    CASE
      WHEN LEAST(1.0, p_blocklist_count::REAL / 8.0) >= 0.8 THEN 'confirmed'
      WHEN LEAST(1.0, p_blocklist_count::REAL / 8.0) >= 0.5 THEN 'high'
      WHEN LEAST(1.0, p_blocklist_count::REAL / 8.0) >= 0.3 THEN 'medium'
      ELSE 'low'
    END
  )
  ON CONFLICT (ip_address) DO UPDATE SET
    last_seen_in_feed  = NOW(),
    feed_sources       = CASE
      WHEN p_feed_source = ANY(scam_ips.feed_sources) THEN scam_ips.feed_sources
      ELSE array_append(scam_ips.feed_sources, p_feed_source)
    END,
    blocklist_count    = GREATEST(scam_ips.blocklist_count, p_blocklist_count),
    port               = COALESCE(p_port, scam_ips.port),
    as_number          = COALESCE(p_as_number, scam_ips.as_number),
    as_name            = COALESCE(p_as_name, scam_ips.as_name),
    country            = COALESCE(p_country, scam_ips.country),
    threat_type        = COALESCE(scam_ips.threat_type, p_threat_type),
    feed_reported_at   = LEAST(scam_ips.feed_reported_at, EXCLUDED.feed_reported_at),
    feed_references    = COALESCE(scam_ips.feed_references, '{}') || v_ref_obj,
    first_seen         = COALESCE(scam_ips.first_seen, p_first_seen),
    last_online        = COALESCE(p_last_online, scam_ips.last_online),
    is_active          = TRUE,
    confidence_score   = LEAST(1.0, GREATEST(scam_ips.blocklist_count, p_blocklist_count)::REAL / 8.0),
    confidence_level   = CASE
      WHEN LEAST(1.0, GREATEST(scam_ips.blocklist_count, p_blocklist_count)::REAL / 8.0) >= 0.8 THEN 'confirmed'
      WHEN LEAST(1.0, GREATEST(scam_ips.blocklist_count, p_blocklist_count)::REAL / 8.0) >= 0.5 THEN 'high'
      WHEN LEAST(1.0, GREATEST(scam_ips.blocklist_count, p_blocklist_count)::REAL / 8.0) >= 0.3 THEN 'medium'
      ELSE 'low'
    END
  WHERE
    scam_ips.last_seen_in_feed IS NULL
    OR scam_ips.last_seen_in_feed < NOW() - INTERVAL '20 hours'
    OR scam_ips.is_active IS DISTINCT FROM TRUE
    OR NOT (p_feed_source = ANY(scam_ips.feed_sources))
    OR GREATEST(scam_ips.blocklist_count, p_blocklist_count)
       IS DISTINCT FROM scam_ips.blocklist_count
    OR (p_port IS NOT NULL AND scam_ips.port IS NULL)
    OR (p_as_number IS NOT NULL AND scam_ips.as_number IS NULL)
    OR (p_as_name IS NOT NULL AND scam_ips.as_name IS NULL)
    OR (p_country IS NOT NULL AND scam_ips.country IS NULL)
    OR (p_threat_type IS NOT NULL AND scam_ips.threat_type IS NULL)
    OR (EXCLUDED.feed_reported_at IS NOT NULL
        AND (scam_ips.feed_reported_at IS NULL
             OR EXCLUDED.feed_reported_at < scam_ips.feed_reported_at))
    OR (p_feed_reference_url IS NOT NULL
        AND NOT (COALESCE(scam_ips.feed_references, '{}') ? p_feed_source))
    OR (p_first_seen IS NOT NULL AND scam_ips.first_seen IS NULL)
    OR (p_last_online IS NOT NULL
        AND p_last_online IS DISTINCT FROM scam_ips.last_online)
  RETURNING id, (xmax = 0) AS is_new_row
  INTO v_ip_id, v_is_new;

  IF v_ip_id IS NULL THEN
    SELECT id INTO v_ip_id FROM scam_ips WHERE ip_address = p_ip_address;
    RETURN json_build_object(
      'scam_ip_id', v_ip_id,
      'is_new', FALSE,
      'unchanged', TRUE
    );
  END IF;

  RETURN json_build_object(
    'scam_ip_id', v_ip_id,
    'is_new', v_is_new
  );
END;
$function$;
