-- migration-v190-analytics-events.sql
-- First-party, owned analytics event store + inbound first-touch attribution.
--
-- WHY: the app already has Plausible (page-level) + Axiom (ops), but there is
-- no OWNED event store and no inbound-UTM / first-touch capture. So a LinkedIn
-- click cannot be attributed to a later scan / report / contact. This migration
-- adds the durable source of truth that joins those conversions back to the
-- channel + campaign that produced the visitor's first session.
--
-- Two tables:
--   visitors          — one row per anonymous_id, WRITE-ONCE first-touch fields
--                        (the anonymous_id + UTMs are captured by middleware in
--                        the aa_attribution cookie; the row is upserted lazily
--                        from the event-write path — never from middleware).
--   analytics_events   — append-only event log; each row is stamped with the
--                        visitor's first-touch UTM/referrer at write time.
--
-- PRIVACY: metadata ONLY. event_props NEVER contains scanned content, phone
-- numbers, URLs, or images — only input *type*, verdict *category*, timing,
-- and campaign metadata. Enforced at the logEvent() writer (apps/web/lib/
-- analytics-events.ts), reaffirmed here for the operator reading the schema.
--
-- RLS: deny-all default; service_role bypasses RLS so it needs no policy. This
-- is the same posture as cost_telemetry / infra_cost_daily (v134). There is NO
-- anon/authenticated policy — browser events are written via the service-role
-- /api/events route, matching house style (the repo has zero FOR INSERT TO anon
-- precedent).

BEGIN;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.visitors (
  anonymous_id           uuid        PRIMARY KEY,
  first_utm_source       text,
  first_utm_medium       text,
  first_utm_campaign     text,
  first_utm_content      text,
  first_utm_term         text,
  first_referrer         text,
  first_referring_domain text,
  landing_path           text,
  first_seen_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id uuid        NOT NULL REFERENCES public.visitors(anonymous_id),
  event_type   text        NOT NULL,
    -- pageview | scan_started | scan_completed | scam_report_submitted
    -- | extension_install | contact_submit | feed_view | digest_click | link_click
  event_props  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  path         text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,
  utm_term     text,
  referrer     text,
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_anon
  ON public.analytics_events (anonymous_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_time
  ON public.analytics_events (event_type, created_at DESC);

-- Service role writes (via /api/events + logEvent). Admin pages read via
-- service role. No public/anon access — deny-all default, service_role bypass.
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
-- Deny-all default; service_role bypasses RLS so it doesn't need a policy.
-- Same pattern as v134 (infra_cost_daily) / v109 (deny-all-policies-followup).

-- ---------------------------------------------------------------------------
-- Read views (consumed by /admin/analytics via the service client)
--
-- Designed to read off the `visitors` table (landing_path, first_seen_at) for
-- arrival/attribution facts rather than depending on `pageview` events, so the
-- funnel/no-scan metrics work before pageview instrumentation lands.
-- ---------------------------------------------------------------------------

-- 1. Daily completed scans (primary conversion).
CREATE OR REPLACE VIEW public.daily_scans
  WITH (security_invoker = on) AS
SELECT date_trunc('day', created_at)::date AS day,
       count(*) AS scans
FROM public.analytics_events
WHERE event_type = 'scan_completed'
GROUP BY 1
ORDER BY 1;

-- 2. Scans split by input type (link/text/phone/image).
CREATE OR REPLACE VIEW public.scans_by_type
  WITH (security_invoker = on) AS
SELECT date_trunc('day', created_at)::date AS day,
       event_props->>'input_type' AS input_type,
       count(*) AS scans
FROM public.analytics_events
WHERE event_type = 'scan_completed'
GROUP BY 1, 2
ORDER BY 1;

-- 3. New vs returning scanners — a scan is "new" if it happened on the same
--    day the visitor was first seen, else "returning".
CREATE OR REPLACE VIEW public.scans_new_vs_returning
  WITH (security_invoker = on) AS
SELECT date_trunc('day', e.created_at)::date AS day,
       count(*) FILTER (
         WHERE date_trunc('day', e.created_at)::date
             = date_trunc('day', v.first_seen_at)::date
       ) AS new_scanner_scans,
       count(*) FILTER (
         WHERE date_trunc('day', e.created_at)::date
             > date_trunc('day', v.first_seen_at)::date
       ) AS returning_scanner_scans
FROM public.analytics_events e
JOIN public.visitors v USING (anonymous_id)
WHERE e.event_type = 'scan_completed'
GROUP BY 1
ORDER BY 1;

-- 4. No-scan visitor rate (the primary growth lever) — visitors who arrived
--    but never fired scan_started, bucketed by arrival day.
CREATE OR REPLACE VIEW public.no_scan_visitor_rate
  WITH (security_invoker = on) AS
WITH v AS (
  SELECT date_trunc('day', vi.first_seen_at)::date AS day,
         vi.anonymous_id,
         EXISTS (
           SELECT 1 FROM public.analytics_events e
           WHERE e.anonymous_id = vi.anonymous_id
             AND e.event_type = 'scan_started'
         ) AS started
  FROM public.visitors vi
)
SELECT day,
       count(*) FILTER (WHERE NOT started) AS no_scan_visitors,
       count(*) AS total_visitors,
       round(100.0 * count(*) FILTER (WHERE NOT started)
             / nullif(count(*), 0), 1) AS no_scan_pct
FROM v
GROUP BY 1
ORDER BY 1;

-- 5. First-touch attributed conversions — join each conversion back to the
--    channel + campaign of the visitor's FIRST session. Channel falls back to
--    the referring domain, then 'direct'.
CREATE OR REPLACE VIEW public.utm_attributed_conversions
  WITH (security_invoker = on) AS
SELECT e.event_type,
       coalesce(v.first_utm_source,
                v.first_referring_domain,
                'direct') AS source,
       v.first_utm_medium   AS medium,
       v.first_utm_campaign AS campaign,
       date_trunc('week', e.created_at)::date AS week,
       count(*) AS conversions
FROM public.analytics_events e
JOIN public.visitors v USING (anonymous_id)
WHERE e.event_type IN ('scan_completed', 'scam_report_submitted', 'contact_submit')
GROUP BY 1, 2, 3, 4, 5
ORDER BY 5 DESC;

-- 6. Content → scan bridge — visitors whose FIRST page was blog/clone-watch
--    content, and how many of them went on to complete a scan.
CREATE OR REPLACE VIEW public.blog_to_scan_funnel
  WITH (security_invoker = on) AS
WITH readers AS (
  SELECT anonymous_id
  FROM public.visitors
  WHERE landing_path LIKE '/blog/%'
     OR landing_path LIKE '/clone-watch%'
),
scanners AS (
  SELECT DISTINCT anonymous_id
  FROM public.analytics_events
  WHERE event_type = 'scan_completed'
)
SELECT (SELECT count(*) FROM readers) AS content_readers,
       (SELECT count(*) FROM readers r
          JOIN scanners s USING (anonymous_id)) AS readers_who_scanned;

COMMIT;
