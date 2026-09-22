-- migration-v315-clone-attribution-platform-projection.sql
--
-- PR 1 of the clone-watch deepening plan (docs/plans/clone-watch-deepening-2026-09-23.md).
-- Two things, both found by querying prod 2026-09-23.
--
-- ── 1. The Platform Entity carries no registrar data ────────────────────────
-- v309 feeds each Weaponised clone into scam_urls/scam_entities with
-- enrichment_status='skipped', so whois_registrar / whois_created_date /
-- whois_registrant_country / whois_name_servers stay NULL on every clone row —
-- prod: 164 fed, 164 with no whois, 138 of them fixable from
-- shopfront_clone_alerts.attribution. The B2B /api/v1/threats/domains registrar
-- breakdown and whois-cached therefore never see clone-watch's RDAP data.
-- Worse, enrichment usually lands AFTER feeding (enrich runs 13:30; a clone can
-- weaponise any time), so a feed-time copy alone would still miss most rows.
--
-- One projection, two callers:
--   project_clone_to_platform_entity(alert_id, scam_url_id)
--     - copies attribution.whois → scam_urls.whois_* (COALESCE: never
--       overwrites a value another feed supplied)
--     - a clone that has since been taken down / gone dormant / expired, and
--       whose scam_urls row has NO other feed source, drops high → medium
--       confidence so mark_stale_urls (which exempts high/confirmed) can retire
--       it. v309 kept it `high` + is_active forever by design; that was right
--       for a live phish and wrong for a dead one.
--   callers: feed_clone_platform_entity (feed time) and an AFTER UPDATE OF
--   attribution, lifecycle_state trigger on shopfront_clone_alerts (enrichment
--   and takedown, whichever Lane writes them). The trigger is WHEN-guarded on
--   the platform_entity stamp, so un-fed alerts pay nothing.
--
-- ── 2. Three worklist RPCs still default to the Haiku-era 0.7 ───────────────
-- ADR-0026: `confidence` is P(clone) since 2026-09-22 and the worklist gate is
-- 0.4 (apps/web/lib/clone-watch/preclassify-thresholds.ts). All TS callers pass
-- the arg, but any caller that omits it (new code, ops psql) silently ran the
-- much tighter 0.7 cut — the worklist-starvation class (v224, v252). Bodies are
-- byte-identical to the live definitions (pg_get_functiondef, 2026-09-23); only
-- the DEFAULT changes. apps/web/__tests__/preclassifyThresholds.test.ts now
-- scans the newest definition of each and asserts the SQL default equals the TS
-- constant.

BEGIN;

-- ── 1a. The projection ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_clone_to_platform_entity(
  p_alert_id bigint,
  p_scam_url_id bigint DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_alert   RECORD;
  v_url_id  bigint;
  v_whois   jsonb;
  v_created date;
BEGIN
  SELECT id, attribution, lifecycle_state, submitted_to
    INTO v_alert
    FROM public.shopfront_clone_alerts
   WHERE id = p_alert_id;
  IF NOT FOUND THEN RETURN false; END IF;

  v_url_id := COALESCE(
    p_scam_url_id,
    NULLIF(v_alert.submitted_to -> 'platform_entity' ->> 'scam_url_id', '')::bigint
  );
  IF v_url_id IS NULL THEN RETURN false; END IF;

  v_whois := v_alert.attribution -> 'whois';
  -- RDAP gives YYYY-MM-DD; whoisjson can give anything. Parse defensively.
  v_created := CASE
    WHEN (v_whois ->> 'createdDate') ~ '^\d{4}-\d{2}-\d{2}'
    THEN left(v_whois ->> 'createdDate', 10)::date
  END;

  UPDATE public.scam_urls su
     SET whois_registrar          = COALESCE(su.whois_registrar, NULLIF(trim(v_whois ->> 'registrar'), '')),
         whois_created_date       = COALESCE(su.whois_created_date, v_created),
         whois_registrant_country = COALESCE(su.whois_registrant_country, NULLIF(trim(v_whois ->> 'registrantCountry'), '')),
         whois_name_servers       = COALESCE(
                                      su.whois_name_servers,
                                      CASE WHEN jsonb_typeof(v_whois -> 'nameServers') = 'array'
                                                AND jsonb_array_length(v_whois -> 'nameServers') > 0
                                           THEN ARRAY(SELECT jsonb_array_elements_text(v_whois -> 'nameServers'))
                                      END),
         whois_lookup_at          = COALESCE(su.whois_lookup_at,
                                      CASE WHEN v_whois IS NOT NULL
                                           THEN NULLIF(v_alert.attribution ->> 'enriched_at', '')::timestamptz END),
         confidence_level         = CASE
                                      WHEN v_alert.lifecycle_state IN ('taken_down', 'dormant', 'expired')
                                           AND su.confidence_level = 'high'
                                           AND su.feed_sources = ARRAY['clone_watch']
                                      THEN 'medium'
                                      ELSE su.confidence_level
                                    END
   WHERE su.id = v_url_id;
  RETURN FOUND;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.project_clone_to_platform_entity(bigint, bigint)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_clone_to_platform_entity(bigint, bigint) IS
  'v315. Projects a fed clone alert onto its Platform Entity scam_urls row: attribution.whois → whois_* (COALESCE, never overwrites another feed) and taken_down/dormant/expired → confidence high→medium when clone_watch is the sole feed source. Called by feed_clone_platform_entity and trg_clone_alert_platform_projection.';

-- ── 1b. Trigger: enrichment + lifecycle changes reach the platform ─────────
CREATE OR REPLACE FUNCTION public.trg_clone_alert_platform_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.project_clone_to_platform_entity(NEW.id, NULL);
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.trg_clone_alert_platform_projection()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clone_alert_platform_projection ON public.shopfront_clone_alerts;
CREATE TRIGGER clone_alert_platform_projection
  AFTER UPDATE OF attribution, lifecycle_state ON public.shopfront_clone_alerts
  FOR EACH ROW
  WHEN (NEW.submitted_to ? 'platform_entity'
        AND (OLD.attribution IS DISTINCT FROM NEW.attribution
             OR OLD.lifecycle_state IS DISTINCT FROM NEW.lifecycle_state))
  EXECUTE FUNCTION public.trg_clone_alert_platform_projection();

-- ── 1c. Feed time calls the same projection ────────────────────────────────
CREATE OR REPLACE FUNCTION public.feed_clone_platform_entity(p_alert_id bigint, p_normalized_url text, p_domain text, p_subdomain text DEFAULT NULL::text, p_tld text DEFAULT ''::text, p_full_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- v315: registrar/WHOIS + lifecycle projection — the SAME function the
  -- shopfront_clone_alerts trigger calls, so feed time and later enrichment
  -- converge on one projection.
  PERFORM public.project_clone_to_platform_entity(p_alert_id, v_url_id);

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
$function$;

-- ── 2. Worklist defaults on the P(clone) scale ─────────────────────────────
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan_submit(p_limit integer DEFAULT 30, p_min_confidence real DEFAULT 0.4, p_max_failure_streak integer DEFAULT 3, p_dead_cadence_hours integer DEFAULT 168)
 RETURNS TABLE(id bigint, candidate_url text, candidate_domain text, inferred_target_domain text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH bounds AS (
    SELECT
      GREATEST(1, LEAST(p_limit, 100)) AS cap,
      -- One third of every batch is reserved for the oldest eligible rows so
      -- fresh inflow can never again starve the backlog to death (D2).
      GREATEST(1, LEAST(p_limit, 100) / 3) AS stale_slots
  ),
  eligible AS (
    SELECT
      sca.id,
      sca.candidate_url,
      sca.candidate_domain,
      sca.inferred_target_domain,
      sca.first_seen_at
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      AND sca.urlscan_uuid IS NULL
      -- v285 (D1): a 400 means "no DNS yet", which is the state we are here to
      -- watch — it must not count toward the death streak. Everything else
      -- keeps the 3-strike rule unchanged.
      AND (
        sca.urlscan_evidence ->> 'status' = '400'
        OR sca.urlscan_failure_streak < p_max_failure_streak
      )
      -- v285 (D2): 14 days -> 90 days, matching list_clone_alerts_for_recheck.
      AND sca.first_seen_at >= now() - interval '90 days'
      -- v279: a domain urlscan refused with a 400 (no DNS) waits out a long
      -- cadence before it is offered a slot again. Not an exclusion — a 400 is
      -- not permanent, and the row returns on its own once the cadence lapses.
      AND (
        sca.urlscan_evidence ->> 'status' IS DISTINCT FROM '400'
        OR sca.urlscan_evidence ->> 'attempted_at' IS NULL
        OR (sca.urlscan_evidence ->> 'attempted_at')::timestamptz
           < now() - make_interval(hours => GREATEST(1, p_dead_cadence_hours))
      )
      AND EXISTS (
        SELECT 1
        FROM public.clone_watch_classifications c
        WHERE c.alert_id = sca.id
          AND c.is_clone
          AND c.confidence >= p_min_confidence
      )
  ),
  ranked AS (
    SELECT
      e.*,
      row_number() OVER (ORDER BY e.first_seen_at DESC) AS fresh_rank,
      row_number() OVER (ORDER BY e.first_seen_at ASC)  AS stale_rank
    FROM eligible e
  )
  SELECT
    r.id,
    r.candidate_url,
    r.candidate_domain,
    r.inferred_target_domain
  FROM ranked r
  CROSS JOIN bounds b
  WHERE r.stale_rank <= b.stale_slots
     OR r.fresh_rank <= b.cap - b.stale_slots
  ORDER BY
    -- Reserved-stale rows go FIRST. They are the ones at risk of crossing the
    -- 90-day horizon; today's fresh rows will still be eligible tomorrow. This
    -- also means the fn's wall-clock break can never re-create the starvation.
    (r.stale_rank <= b.stale_slots) DESC,
    CASE WHEN r.stale_rank <= b.stale_slots
         THEN r.stale_rank    -- within the reserve: oldest first
         ELSE r.fresh_rank    -- within the remainder: newest first
    END ASC
  LIMIT (SELECT cap FROM bounds);
$function$;

CREATE OR REPLACE FUNCTION public.mark_stale_clone_alerts_dormant(p_horizon_days integer DEFAULT 90, p_min_confidence real DEFAULT 0.4, p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    SELECT sca.id
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      AND sca.lifecycle_state = 'detected'
      AND sca.urlscan_uuid IS NULL
      AND sca.urlscan_classification IS NULL
      AND sca.first_seen_at
          < now() - make_interval(days => GREATEST(1, p_horizon_days))
      AND EXISTS (
        SELECT 1
        FROM public.clone_watch_classifications c
        WHERE c.alert_id = sca.id
          AND c.is_clone
          AND c.confidence >= p_min_confidence
      )
    ORDER BY sca.first_seen_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 2000))
  )
  UPDATE public.shopfront_clone_alerts t
  SET lifecycle_state = 'dormant',
      -- v286: keep the COARSE disposition in sync, exactly as
      -- advance_clone_lifecycle (v199:195-198) does for terminal states.
      -- Without this the row stays alert_state='open' and keeps inflating
      -- aggregate_open_clone_alerts_by_brand on /admin/brand-register.
      alert_state = 'expired',
      updated_at = now()
  FROM stale
  WHERE t.id = stale.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_auto(p_min_confidence real DEFAULT 0.4, p_daily_cap integer DEFAULT 50)
 RETURNS TABLE(id bigint, candidate_url text, candidate_domain text, inferred_target_domain text, severity_tier text, signals jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH today AS (
    SELECT count(*)::int AS n
    FROM public.shopfront_clone_alerts
    WHERE submitted_to -> 'netcraft' ->> 'via' = 'auto_bulk'
      AND (submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= date_trunc('day', now())
  )
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.severity_tier,
    sca.signals
  FROM public.shopfront_clone_alerts sca
  WHERE sca.inferred_target_domain IS NOT NULL
    AND NOT (sca.submitted_to ? 'netcraft')
    AND COALESCE(sca.triage_status, '') <> 'fp'
    AND lower(sca.inferred_target_domain) NOT IN
      ('domain.com.au', 'allhomes.com.au', 'lendi.com.au')
    AND sca.first_seen_at >= now() - interval '180 days'
    -- v284 evidence gate: an independent observation that this host is
    -- actually hostile. Mirrors the issue reporter's v221 predicate.
    AND (
      sca.urlscan_classification = 'likely_phishing'
      OR sca.lifecycle_state = 'weaponised'
    )
    AND EXISTS (
      SELECT 1
      FROM public.clone_watch_classifications c
      WHERE c.alert_id = sca.id
        AND c.is_clone
        AND c.confidence >= p_min_confidence
    )
  ORDER BY
    -- Weaponised first: those are live and already escalation-eligible.
    (sca.lifecycle_state = 'weaponised') DESC,
    -- Then freshest, because time-to-report drives time-to-takedown. Lexical
    -- confidence survives only as a tiebreak — v284 measured it as noise for
    -- ranking purposes, so it must not lead.
    sca.first_seen_at DESC,
    (SELECT max(c.confidence)
       FROM public.clone_watch_classifications c
       WHERE c.alert_id = sca.id AND c.is_clone) DESC NULLS LAST
  LIMIT LEAST(
    GREATEST(0, p_daily_cap - (SELECT n FROM today)),
    50
  );
$function$;

COMMIT;

-- ── Backfill (idempotent; 164 rows in prod 2026-09-23) ─────────────────────
SELECT public.project_clone_to_platform_entity(a.id, NULL)
  FROM public.shopfront_clone_alerts a
 WHERE a.submitted_to ? 'platform_entity';
