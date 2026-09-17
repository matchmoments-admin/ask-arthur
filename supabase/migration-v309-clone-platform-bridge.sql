-- migration-v309-clone-platform-bridge.sql
--
-- The platform bridge for Clone Watch (#1151, map #1143): a weaponised clone
-- becomes a Platform Entity — a scam_entities row (domain, and the hosting IP
-- when urlscan captured one) plus a scam_urls row — in ONE transaction, with
-- the write recorded on the alert's `submitted_to` ledger and a reverse path.
--
-- WHY TWO ROWS. Measured 2026-09-17 against the code, not the ticket:
-- scam_entities is read by /api/scam-contacts/lookup, /api/v1/entities/*,
-- /scam-map, the dashboards, shop-signal's infrastructure-cluster join and the
-- entity-enrichment → risk-scorer chain. It is NOT read by the extension —
-- /api/extension/url-check reads scam_urls by exact normalized_url — and the
-- web checker's verdict path reads neither (GSB + VirusTotal only). So
-- "reaches the platform" is the entity row AND a scam_urls row; the web
-- checker gap is a separate finding on the map.
--
-- WHY NOT report_scam_entity / upsert_scam_url. Both are the consumer "I am
-- reporting this" adapters: they bump report_count / unique_reporter_count and
-- insert a scam_url_reports row per call. A machine observation is not a
-- report, and neither is idempotent — a retry would inflate the count. This
-- RPC is feed-shaped (feed_sources / feed_references / last_seen_in_feed, the
-- same columns the scrapers write) and idempotent on the ledger stamp.
--
-- WHY confidence_level = 'high' on the scam_urls row. Every one of the 503K
-- feed rows is 'low'; 'high' is reserved for "HIGH_RISK from Claude analysis"
-- and exempts the row from the 7-day staleness sweep. A urlscan-verified live
-- credential-phishing page impersonating a named brand is that bar. The row
-- is therefore NOT expired by mark_stale_urls; the retraction RPC is the only
-- way it leaves is_active (and the reemergence/takedown lifecycle does not
-- withdraw it — a taken-down clone is still a clone).
--
-- WHAT THE ENTRY DOES NOT CARRY: report_count stays at the default (1 on
-- insert, untouched on conflict); legal_basis stays at its default
-- 'public_interest_research_unverified' (machine-classified, never
-- human-verified); provenance_tier is tier_4_osint (a urlscan verdict is
-- open-source intelligence, not a regulator/industry/curated source) and is
-- only set when NULL so a higher tier from another source is never lowered.
--
-- RETRACTION (fog item on the map, resolved here as: withdraw, not down-
-- weight). A weaponised row never reverts — weaponised_at is first-touch — so
-- the only trigger is triage 'fp'. retract_clone_platform_entity removes the
-- 'clone_watch' source from both rows; the entity row is DELETED only when
-- clone_watch was its sole source and nothing links a report to it, and the
-- scam_urls row goes is_active = FALSE only when clone_watch was its sole
-- source. Anything another feed or a user also vouched for is left as theirs.
-- This is also the documented manual reverse: SELECT retract_clone_platform_entity(<id>).
--
-- WORKLIST. list_clone_alerts_pending_platform_entity is what the consumer
-- calls; it is a real RPC so the worklist can be CALLED, never reasoned about
-- from its WHERE clause (house rule). Its gate is "weaponised, not fp, not yet
-- stamped" — and the stamp is written by the same transaction that does the
-- work, so a fed row leaves the worklist atomically
-- (worklist-gate-starvation-rule: the write moves the row across the exact
-- predicate the worklist filters on). A retracted row carries
-- platform_entity.retracted_at and is ALSO excluded, so an fp never re-feeds.
--
-- Idempotent: CREATE OR REPLACE / ON CONFLICT DO NOTHING. Reverse: DROP the
-- three functions; rows already written are reversed per alert by the
-- retraction RPC.

BEGIN;
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0. Roster entry so the 'clone_watch' slug in feed_sources arrays resolves.
--    enabled = false: it is not a polled feed, and feed_health must not page
--    on it. staleness_exempt stays false — exemption for these rows comes
--    from confidence_level = 'high', not from the feed.
-- ---------------------------------------------------------------------------
INSERT INTO public.feed_sources (slug, name, url, source_type, category, jurisdiction, enabled, notes)
VALUES (
  'clone_watch',
  'Clone Watch (weaponised lookalikes)',
  'https://askarthur.au/clone-watch',
  'api',      -- constraint allows rss/html/csv/json/pdf/email/api/ws/mixed; urlscan's verdict arrives via its API
  'derived',  -- the existing category for sources computed from other feeds (same as the reddit-derived rows)
  'AU',
  false,
  'v309: internal source class. Rows are written by feed_clone_platform_entity() at the weaponise transition, never polled. Not a feed_health participant.'
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. The write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.feed_clone_platform_entity(
  p_alert_id       BIGINT,
  p_normalized_url TEXT,
  p_domain         TEXT,
  p_subdomain      TEXT DEFAULT NULL,
  p_tld            TEXT DEFAULT '',
  p_full_path      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_alert          RECORD;
  v_ip             TEXT;
  v_country        TEXT;
  v_brand          TEXT;
  v_ref            JSONB;
  v_domain_id      BIGINT;
  v_ip_id          BIGINT;
  v_url_id         BIGINT;
  v_stamp          JSONB;
BEGIN
  SELECT id, candidate_domain, candidate_url, inferred_target_domain,
         weaponised_at, triage_status, urlscan_uuid, urlscan_evidence, submitted_to
    INTO v_alert
    FROM public.shopfront_clone_alerts
   WHERE id = p_alert_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('written', false, 'reason', 'not_found');
  END IF;
  IF v_alert.weaponised_at IS NULL THEN
    RETURN jsonb_build_object('written', false, 'reason', 'not_weaponised');
  END IF;
  IF v_alert.triage_status = 'fp' THEN
    RETURN jsonb_build_object('written', false, 'reason', 'triaged_fp');
  END IF;
  IF v_alert.submitted_to ? 'platform_entity' THEN
    RETURN jsonb_build_object(
      'written', false,
      'reason', CASE WHEN v_alert.submitted_to->'platform_entity' ? 'retracted_at'
                     THEN 'retracted' ELSE 'already_fed' END,
      'platform_entity', v_alert.submitted_to->'platform_entity'
    );
  END IF;

  v_ip      := NULLIF(trim(v_alert.urlscan_evidence->'server'->>'ip'), '');
  v_country := NULLIF(upper(trim(v_alert.urlscan_evidence->'server'->>'country')), '');
  v_brand   := NULLIF(trim(v_alert.inferred_target_domain), '');
  v_ref     := jsonb_build_object('clone_watch', jsonb_build_object(
                 'alert_id',      v_alert.id,
                 'urlscan_uuid',  v_alert.urlscan_uuid,
                 'candidate_url', v_alert.candidate_url,
                 'weaponised_at', v_alert.weaponised_at
               ));

  -- Domain entity.
  INSERT INTO public.scam_entities (
    entity_type, normalized_value, raw_value, country_code,
    feed_sources, last_seen_in_feed, feed_reported_at, feed_references,
    provenance_tier
  )
  VALUES (
    'domain', lower(trim(v_alert.candidate_domain)), v_alert.candidate_domain, v_country,
    ARRAY['clone_watch'], now(), v_alert.weaponised_at, v_ref,
    'tier_4_osint'
  )
  ON CONFLICT (entity_type, normalized_value) DO UPDATE SET
    last_seen         = now(),
    last_seen_in_feed = now(),
    feed_sources      = CASE WHEN 'clone_watch' = ANY(public.scam_entities.feed_sources)
                             THEN public.scam_entities.feed_sources
                             ELSE array_append(public.scam_entities.feed_sources, 'clone_watch') END,
    feed_reported_at  = LEAST(public.scam_entities.feed_reported_at, EXCLUDED.feed_reported_at),
    feed_references   = public.scam_entities.feed_references || EXCLUDED.feed_references,
    country_code      = COALESCE(public.scam_entities.country_code, EXCLUDED.country_code),
    provenance_tier   = COALESCE(public.scam_entities.provenance_tier, EXCLUDED.provenance_tier)
  RETURNING id INTO v_domain_id;

  -- Hosting IP entity (only when urlscan captured one).
  IF v_ip IS NOT NULL THEN
    INSERT INTO public.scam_entities (
      entity_type, normalized_value, raw_value, country_code,
      feed_sources, last_seen_in_feed, feed_reported_at, feed_references,
      provenance_tier
    )
    VALUES (
      'ip', v_ip, v_ip, v_country,
      ARRAY['clone_watch'], now(), v_alert.weaponised_at, v_ref,
      'tier_4_osint'
    )
    ON CONFLICT (entity_type, normalized_value) DO UPDATE SET
      last_seen         = now(),
      last_seen_in_feed = now(),
      feed_sources      = CASE WHEN 'clone_watch' = ANY(public.scam_entities.feed_sources)
                               THEN public.scam_entities.feed_sources
                               ELSE array_append(public.scam_entities.feed_sources, 'clone_watch') END,
      feed_reported_at  = LEAST(public.scam_entities.feed_reported_at, EXCLUDED.feed_reported_at),
      feed_references   = public.scam_entities.feed_references || EXCLUDED.feed_references,
      country_code      = COALESCE(public.scam_entities.country_code, EXCLUDED.country_code),
      provenance_tier   = COALESCE(public.scam_entities.provenance_tier, EXCLUDED.provenance_tier)
    RETURNING id INTO v_ip_id;
  END IF;

  -- scam_urls row: what the extension's url-check and /api/v1/threats read.
  INSERT INTO public.scam_urls (
    normalized_url, domain, subdomain, tld, full_path,
    source_type, primary_scam_type, brand_impersonated, country_code,
    feed_sources, last_seen_in_feed, feed_reported_at, feed_references,
    confidence_level, is_active, enrichment_status
  )
  VALUES (
    p_normalized_url, p_domain, p_subdomain, COALESCE(p_tld, ''), p_full_path,
    'feed', 'phishing', v_brand, v_country,
    ARRAY['clone_watch'], now(), v_alert.weaponised_at, v_ref,
    'high', TRUE, 'skipped'
  )
  ON CONFLICT (normalized_url) DO UPDATE SET
    last_seen_in_feed  = now(),
    feed_reported_at   = LEAST(public.scam_urls.feed_reported_at, EXCLUDED.feed_reported_at),
    feed_sources       = CASE WHEN 'clone_watch' = ANY(public.scam_urls.feed_sources)
                              THEN public.scam_urls.feed_sources
                              ELSE array_append(public.scam_urls.feed_sources, 'clone_watch') END,
    feed_references    = public.scam_urls.feed_references || EXCLUDED.feed_references,
    primary_scam_type  = COALESCE(public.scam_urls.primary_scam_type, EXCLUDED.primary_scam_type),
    brand_impersonated = COALESCE(public.scam_urls.brand_impersonated, EXCLUDED.brand_impersonated),
    country_code       = COALESCE(public.scam_urls.country_code, EXCLUDED.country_code),
    -- Never lower an existing 'confirmed'; raise 'low'/'medium' to 'high'.
    confidence_level   = CASE WHEN public.scam_urls.confidence_level = 'confirmed'
                              THEN 'confirmed' ELSE 'high' END,
    is_active          = TRUE
  RETURNING id INTO v_url_id;

  v_stamp := jsonb_build_object(
    'at',           now(),
    'domain_entity_id', v_domain_id,
    'ip_entity_id',     v_ip_id,
    'scam_url_id',      v_url_id
  );

  UPDATE public.shopfront_clone_alerts
     SET submitted_to = COALESCE(submitted_to, '{}'::jsonb)
                        || jsonb_build_object('platform_entity', v_stamp),
         updated_at   = now()
   WHERE id = p_alert_id;

  RETURN jsonb_build_object('written', true) || v_stamp;
END;
$$;

REVOKE ALL ON FUNCTION public.feed_clone_platform_entity(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feed_clone_platform_entity(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.feed_clone_platform_entity(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'v309: write a weaponised clone as a Platform Entity — scam_entities (domain + hosting IP) and a scam_urls row — atomically, stamping submitted_to.platform_entity. Idempotent on the stamp; refuses fp and non-weaponised rows. Reverse: retract_clone_platform_entity.';

-- ---------------------------------------------------------------------------
-- 2. The reverse
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retract_clone_platform_entity(p_alert_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_alert     RECORD;
  v_stamp     JSONB;
  v_ids       BIGINT[];
  v_deleted   INT := 0;
  v_detached  INT := 0;
  v_url_off   BOOLEAN := FALSE;
  v_url_id    BIGINT;
BEGIN
  SELECT id, submitted_to
    INTO v_alert
    FROM public.shopfront_clone_alerts
   WHERE id = p_alert_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('retracted', false, 'reason', 'not_found');
  END IF;
  v_stamp := v_alert.submitted_to->'platform_entity';
  IF v_stamp IS NULL THEN
    RETURN jsonb_build_object('retracted', false, 'reason', 'never_fed');
  END IF;
  IF v_stamp ? 'retracted_at' THEN
    RETURN jsonb_build_object('retracted', false, 'reason', 'already_retracted');
  END IF;

  -- `x #>> '{}'` is how a jsonb scalar is read as text (`x->>0` on a scalar
  -- returns NULL). The ip id may be JSON null when urlscan captured no IP.
  v_ids := ARRAY(
    SELECT (x #>> '{}')::bigint FROM jsonb_array_elements(
      jsonb_build_array(v_stamp->'domain_entity_id', v_stamp->'ip_entity_id')
    ) AS x WHERE jsonb_typeof(x) = 'number'
  );

  -- Entities: delete when clone_watch was the sole source and nothing links a
  -- report; otherwise detach the source and keep the row as the other
  -- sources' finding.
  WITH gone AS (
    DELETE FROM public.scam_entities e
     WHERE e.id = ANY(v_ids)
       AND e.feed_sources = ARRAY['clone_watch']
       AND NOT EXISTS (SELECT 1 FROM public.report_entity_links l WHERE l.entity_id = e.id)
     RETURNING e.id
  )
  SELECT count(*) INTO v_deleted FROM gone;

  UPDATE public.scam_entities e
     SET feed_sources    = array_remove(e.feed_sources, 'clone_watch'),
         feed_references = e.feed_references - 'clone_watch'
   WHERE e.id = ANY(v_ids)
     AND 'clone_watch' = ANY(e.feed_sources);
  GET DIAGNOSTICS v_detached = ROW_COUNT;

  -- scam_urls: deactivate only when clone_watch was the sole source (and the
  -- confidence we raised comes back down); otherwise just detach the source.
  v_url_id := (v_stamp->>'scam_url_id')::bigint;
  IF v_url_id IS NOT NULL THEN
    UPDATE public.scam_urls u
       SET is_active        = CASE WHEN u.feed_sources = ARRAY['clone_watch'] THEN FALSE ELSE u.is_active END,
           confidence_level = CASE WHEN u.feed_sources = ARRAY['clone_watch'] AND u.confidence_level = 'high'
                                   THEN 'low' ELSE u.confidence_level END,
           feed_sources     = array_remove(u.feed_sources, 'clone_watch'),
           feed_references  = u.feed_references - 'clone_watch',
           staleness_checked_at = CASE WHEN u.feed_sources = ARRAY['clone_watch'] THEN now() ELSE u.staleness_checked_at END
     WHERE u.id = v_url_id
     RETURNING (u.is_active = FALSE) INTO v_url_off;
  END IF;

  UPDATE public.shopfront_clone_alerts
     SET submitted_to = jsonb_set(
           submitted_to, '{platform_entity}',
           v_stamp || jsonb_build_object(
             'retracted_at', now(),
             'entities_deleted', v_deleted,
             'entities_detached', v_detached,
             'scam_url_deactivated', v_url_off
           )),
         updated_at = now()
   WHERE id = p_alert_id;

  RETURN jsonb_build_object(
    'retracted', true,
    'entities_deleted', v_deleted,
    'entities_detached', v_detached,
    'scam_url_deactivated', v_url_off
  );
END;
$$;

REVOKE ALL ON FUNCTION public.retract_clone_platform_entity(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retract_clone_platform_entity(BIGINT) TO service_role;

COMMENT ON FUNCTION public.retract_clone_platform_entity(BIGINT) IS
  'v309: withdraw a clone-sourced Platform Entity (triage fp, or manual reverse). Deletes entity rows only when clone_watch was their sole source and no report links them; deactivates the scam_urls row only when clone_watch was its sole source. Stamps submitted_to.platform_entity.retracted_at so the worklist never re-feeds it.';

-- ---------------------------------------------------------------------------
-- 3. The worklist (callable — never reason from the predicate)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_platform_entity(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id                     BIGINT,
  candidate_domain       TEXT,
  candidate_url          TEXT,
  inferred_target_domain TEXT,
  weaponised_at          TIMESTAMPTZ,
  triage_status          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.id, a.candidate_domain, a.candidate_url, a.inferred_target_domain,
         a.weaponised_at, a.triage_status
    FROM public.shopfront_clone_alerts a
   WHERE a.weaponised_at IS NOT NULL
     AND a.triage_status IS DISTINCT FROM 'fp'
     AND NOT (COALESCE(a.submitted_to, '{}'::jsonb) ? 'platform_entity')
   ORDER BY a.weaponised_at DESC
   LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_pending_platform_entity(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_platform_entity(INT) TO service_role;

COMMENT ON FUNCTION public.list_clone_alerts_pending_platform_entity(INT) IS
  'v309: worklist for shopfront-clone-feed-platform — weaponised, not fp, not yet stamped submitted_to.platform_entity (a retracted stamp still counts as stamped). Newest weaponisation first.';

COMMIT;
