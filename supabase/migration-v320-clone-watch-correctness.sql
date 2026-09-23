-- migration-v320-clone-watch-correctness.sql
--
-- PR B ("correctness") of the clone-watch review that followed the 2026-09-23
-- deepening plan. Three function bodies restated from their live definitions
-- (pg_get_functiondef, 2026-09-23) with the smallest correct change each, plus
-- an idempotent backfill. Nothing here rewrites a table; the backfill touches
-- at most the 164 Platform-Entity scam_urls rows (7 in prod need a change).
--
-- ── 1. project_clone_to_platform_entity (v315) ─────────────────────────────
-- SQL twin of readAttribution (apps/web/lib/clone-watch/attribution.ts) —
-- the two MUST agree on how a whois field is read; change them together.
--   (a) registrar stored as a JSON array (WHOIS returns a list of records;
--       prod 2026-06-15 had ["GoDaddy.com, LLC","Reseller"]): `->>` on an array
--       yields its JSON text, which the COALESCE then pinned onto
--       scam_urls.whois_registrar forever. Now the first non-empty element,
--       exactly as the TS reader's firstStr.
--   (b) this function runs inside an AFTER UPDATE trigger on
--       shopfront_clone_alerts, so ANY exception rolls back the enrichment or
--       lifecycle write that fired it. `'2024-13-45'` passed the old regex and
--       raised on ::date; a malformed enriched_at raised on ::timestamptz.
--       Both casts now go through a guarded block that yields NULL.
--   (c) the confidence change was one-way (high → medium on taken_down /
--       dormant / expired). A sole-source row whose alert is `weaponised` again
--       goes back to high, active, and fresh in the feed. Defensive: the
--       lifecycle spec (lib/clone-watch/lifecycle.ts) has no edge out of
--       taken_down/dormant today, but the projection must be symmetric the day
--       one is added rather than silently keep a live phish at medium.
--   (d) an implausible createdDate — more than a year before the alert's own
--       first_seen_at — is a parent-zone date (appley.eu.cc reported 1997 for
--       eu.cc), not this domain's registration. Treated as unknown, as
--       readAttribution does when given firstSeenAt.
--   (e) a retracted Platform Entity (triage fp) is not projected onto again.
--
-- ── 2. record_netcraft_url_verdicts (v316) ─────────────────────────────────
-- `unchanged_reads` is the reconcile backoff counter. The apply step is an
-- Inngest step: a retried step re-applies the same verdicts and used to count
-- the same read twice, backing a row off early. It now increments only when
-- the stored read is older than 1 hour (a genuinely new read: the reconcile
-- cadence is ≥12 h); a same-hour re-apply keeps the counter as it was.
--
-- ── 3. count_todays_takedown_submissions (v318) ────────────────────────────
-- Counted `shopfront_clone_submit_netcraft`, the per-candidate Netcraft lane
-- deleted 2026-09-23 — a dead term. DECISION: Netcraft is NOT in the shared
-- cap. The shared cap protects the one email sending identity that APWG,
-- OpenPhish and the registrar/hosting abuse desks all see (Resend,
-- brendan@askarthur.au); Netcraft is an API with its own reporter standing and
-- already has dedicated caps (auto lane: 50/day inside
-- list_clone_alerts_pending_netcraft_auto; resubmit lane:
-- NETCRAFT_RESUBMIT_DAILY_CAP; issues: count_todays_netcraft_issues — the
-- v215 precedent for keeping a distinct action on its own cap). Folding
-- Netcraft's bulk_submit units in would let one 50-URL batch starve every
-- blocklist send for the day. clone-watch-enforcement-execute.ts's header now
-- says the same.
--
-- Reverse path: re-apply migration-v315 §1a, migration-v316 §1 and
-- migration-v318 §6 (all CREATE OR REPLACE). The backfill only nulls values
-- this function would no longer write, on rows clone_watch solely owns.

BEGIN;

-- ── 1. The projection ──────────────────────────────────────────────────────
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
  v_alert     RECORD;
  v_url_id    bigint;
  v_whois     jsonb;
  v_registrar text;
  v_created   date;
  v_enriched  timestamptz;
BEGIN
  SELECT id, attribution, lifecycle_state, submitted_to, first_seen_at
    INTO v_alert
    FROM public.shopfront_clone_alerts
   WHERE id = p_alert_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- v320 (e): a retracted Platform Entity is no longer ours to project onto.
  IF v_alert.submitted_to -> 'platform_entity' ? 'retracted_at' THEN
    RETURN false;
  END IF;

  v_url_id := COALESCE(
    p_scam_url_id,
    NULLIF(v_alert.submitted_to -> 'platform_entity' ->> 'scam_url_id', '')::bigint
  );
  IF v_url_id IS NULL THEN RETURN false; END IF;

  v_whois := v_alert.attribution -> 'whois';

  -- v320 (a): first non-empty entry of a list, else the scalar (readAttribution's firstStr).
  v_registrar := CASE pg_catalog.jsonb_typeof(v_whois -> 'registrar')
    WHEN 'array' THEN (
      SELECT NULLIF(pg_catalog.btrim(e), '')
        FROM pg_catalog.jsonb_array_elements_text(v_whois -> 'registrar') AS e
       WHERE NULLIF(pg_catalog.btrim(e), '') IS NOT NULL
       LIMIT 1)
    ELSE NULLIF(pg_catalog.btrim(v_whois ->> 'registrar'), '')
  END;

  -- v320 (b): never raise inside the trigger — an unparseable value is unknown.
  BEGIN
    v_created := CASE
      WHEN (v_whois ->> 'createdDate') ~ '^\d{4}-\d{2}-\d{2}'
      THEN pg_catalog.left(v_whois ->> 'createdDate', 10)::date
    END;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    v_created := NULL;
  END;
  -- v320 (d): a parent-zone date, not this domain's.
  IF v_created IS NOT NULL
     AND v_alert.first_seen_at IS NOT NULL
     AND v_created < (v_alert.first_seen_at - interval '1 year')::date THEN
    v_created := NULL;
  END IF;

  IF v_whois IS NOT NULL THEN
    BEGIN
      v_enriched := NULLIF(v_alert.attribution ->> 'enriched_at', '')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      v_enriched := NULL;
    END;
  END IF;

  UPDATE public.scam_urls su
     SET whois_registrar          = COALESCE(su.whois_registrar, v_registrar),
         whois_created_date       = COALESCE(su.whois_created_date, v_created),
         whois_registrant_country = COALESCE(su.whois_registrant_country, NULLIF(pg_catalog.btrim(v_whois ->> 'registrantCountry'), '')),
         whois_name_servers       = COALESCE(
                                      su.whois_name_servers,
                                      CASE WHEN pg_catalog.jsonb_typeof(v_whois -> 'nameServers') = 'array'
                                                AND pg_catalog.jsonb_array_length(v_whois -> 'nameServers') > 0
                                           THEN ARRAY(SELECT pg_catalog.jsonb_array_elements_text(v_whois -> 'nameServers'))
                                      END),
         whois_lookup_at          = COALESCE(su.whois_lookup_at, v_enriched),
         confidence_level         = CASE
                                      WHEN v_alert.lifecycle_state IN ('taken_down', 'dormant', 'expired')
                                           AND su.confidence_level = 'high'
                                           AND su.feed_sources = ARRAY['clone_watch']
                                      THEN 'medium'
                                      -- v320 (c): weaponised again → back to high.
                                      WHEN v_alert.lifecycle_state = 'weaponised'
                                           AND su.confidence_level = 'medium'
                                           AND su.feed_sources = ARRAY['clone_watch']
                                      THEN 'high'
                                      ELSE su.confidence_level
                                    END,
         is_active                = CASE
                                      WHEN v_alert.lifecycle_state = 'weaponised'
                                           AND su.confidence_level = 'medium'
                                           AND su.feed_sources = ARRAY['clone_watch']
                                      THEN TRUE
                                      ELSE su.is_active
                                    END,
         last_seen_in_feed        = CASE
                                      WHEN v_alert.lifecycle_state = 'weaponised'
                                           AND su.confidence_level = 'medium'
                                           AND su.feed_sources = ARRAY['clone_watch']
                                      THEN pg_catalog.now()
                                      ELSE su.last_seen_in_feed
                                    END
   WHERE su.id = v_url_id;
  RETURN FOUND;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.project_clone_to_platform_entity(bigint, bigint)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_clone_to_platform_entity(bigint, bigint) IS
  'v315/v320. SQL twin of readAttribution (apps/web/lib/clone-watch/attribution.ts). Projects a fed clone alert onto its Platform Entity scam_urls row: attribution.whois → whois_* (COALESCE, never overwrites another feed; list-valued registrar → first entry; a createdDate >1y before first_seen_at is a parent-zone date → unknown; unparseable dates → unknown, never raise) and, when clone_watch is the sole feed source, taken_down/dormant/expired → confidence high→medium, weaponised → medium→high (+ active). Skips a retracted entity. Called by feed_clone_platform_entity and trg_clone_alert_platform_projection.';

-- ── 2. Idempotent unchanged_reads ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_netcraft_url_verdicts(p_verdicts jsonb)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  WITH v AS (
    SELECT
      (e ->> 'id')::bigint                         AS id,
      NULLIF(e ->> 'url_state', '')                AS url_state,
      NULLIF(e ->> 'reason', '')                   AS reason,
      NULLIF(e ->> 'malicious_at', '')::timestamptz AS malicious_at,
      NULLIF(e ->> 'netcraft_submitted_at', '')::timestamptz AS nc_submitted_at
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_verdicts, '[]'::jsonb)) e
    WHERE (e ->> 'id') IS NOT NULL
  ),
  calc AS (
    SELECT
      sca.id,
      v.url_state,
      v.reason,
      v.malicious_at,
      -- LEAST ignores NULLs: whichever clock we have, the earlier one wins.
      LEAST(
        (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz,
        v.nc_submitted_at
      )                                                                     AS submitted_at,
      (sca.submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz AS issue_at,
      sca.submitted_to
    FROM public.shopfront_clone_alerts sca
    JOIN v ON v.id = sca.id
    WHERE sca.submitted_to ? 'netcraft'
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET submitted_to = (
      SELECT pg_catalog.jsonb_set(
        c.submitted_to,
        '{netcraft}',
        ((c.submitted_to -> 'netcraft') - 'already_malicious_at_submit')
          || pg_catalog.jsonb_build_object(
               'url_state',        c.url_state,
               'url_state_reason', c.reason,
               'url_state_at',     pg_catalog.now()::text,
               -- v316 backoff input: consecutive reads with the same verdict.
               -- v320: only a read newer than the stored one by >1 h counts —
               -- a retried apply step re-applies the SAME read and must not
               -- count it twice. A changed verdict still resets to 0.
               'unchanged_reads',  CASE
                 WHEN (c.submitted_to -> 'netcraft' ->> 'url_state') IS DISTINCT FROM c.url_state
                 THEN 0
                 WHEN (c.submitted_to -> 'netcraft' ->> 'url_state_at') IS NOT NULL
                      AND (c.submitted_to -> 'netcraft' ->> 'url_state_at')::timestamptz
                          > pg_catalog.now() - interval '1 hour'
                 THEN COALESCE((c.submitted_to -> 'netcraft' ->> 'unchanged_reads')::int, 0)
                 ELSE COALESCE((c.submitted_to -> 'netcraft' ->> 'unchanged_reads')::int, 0) + 1
               END
             )
          -- Vendor-dated takedown: first stamp only, never before our submission.
          || CASE
               WHEN c.malicious_at IS NOT NULL
                    AND c.submitted_at IS NOT NULL
                    AND c.malicious_at >= c.submitted_at
                    AND (c.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
               THEN pg_catalog.jsonb_build_object(
                      'takedown_at',        c.malicious_at::text,
                      'takedown_at_source', 'netcraft_log'
                    )
                    || CASE
                         WHEN c.issue_at IS NOT NULL AND c.malicious_at >= c.issue_at
                         THEN pg_catalog.jsonb_build_object('re_takedown_at', c.malicious_at::text)
                         ELSE '{}'::jsonb
                       END
               ELSE '{}'::jsonb
             END
          -- Already on Netcraft's list before we reported it: not our credit,
          -- and a negative duration must never reach the TTD KPI.
          || CASE
               WHEN c.malicious_at IS NOT NULL
                    AND c.submitted_at IS NOT NULL
                    AND c.malicious_at < c.submitted_at
               THEN pg_catalog.jsonb_build_object('already_malicious_at_submit', true)
               ELSE '{}'::jsonb
             END,
        true
      )
      FROM calc c WHERE c.id = sca.id
    ),
    updated_at = pg_catalog.now()
    WHERE sca.id IN (SELECT id FROM calc)
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

-- ── 3. The shared daily cap counts only the shared sending identity ───────
CREATE OR REPLACE FUNCTION public.count_todays_takedown_submissions()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  -- v320: blocklist + registrar/hosting abuse sends only. Netcraft has its own
  -- caps (see the migration header); the deleted per-candidate Netcraft lane's
  -- `shopfront_clone_submit_netcraft` feature is no longer counted.
  SELECT COALESCE(sum(units), 0)::int
  FROM public.cost_telemetry
  WHERE created_at >= date_trunc('day', now())
    AND feature = 'clone_enforcement'
    AND operation IN ('enforcement.reported', 'enforcement.queued');
$$;

REVOKE EXECUTE ON FUNCTION public.count_todays_takedown_submissions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_todays_takedown_submissions()
  TO service_role;

-- ── Backfill (idempotent; clone_watch-sole-source rows only) ──────────────
-- Values the v315 projection wrote that v320 would not have: a JSON-array
-- registrar (0 in prod 2026-09-23) and a parent-zone createdDate (7 in prod).
-- Nulled, then the projection re-runs and fills what it now reads correctly.
UPDATE public.scam_urls su
   SET whois_registrar = NULL
  FROM public.shopfront_clone_alerts a
 WHERE a.submitted_to ? 'platform_entity'
   AND su.id = NULLIF(a.submitted_to -> 'platform_entity' ->> 'scam_url_id', '')::bigint
   AND su.feed_sources = ARRAY['clone_watch']
   AND su.whois_registrar LIKE '[%';

UPDATE public.scam_urls su
   SET whois_created_date = NULL
  FROM public.shopfront_clone_alerts a
 WHERE a.submitted_to ? 'platform_entity'
   AND su.id = NULLIF(a.submitted_to -> 'platform_entity' ->> 'scam_url_id', '')::bigint
   AND su.feed_sources = ARRAY['clone_watch']
   AND a.first_seen_at IS NOT NULL
   AND su.whois_created_date < (a.first_seen_at - interval '1 year')::date;

COMMIT;

SELECT public.project_clone_to_platform_entity(a.id, NULL)
  FROM public.shopfront_clone_alerts a
 WHERE a.submitted_to ? 'platform_entity';
