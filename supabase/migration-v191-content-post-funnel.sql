-- migration-v191-content-post-funnel.sql
-- Per-post content -> conversion view, keyed on first-touch landing_path.
--
-- WHY: v190's blog_to_scan_funnel gives a single aggregate (all content readers
-- vs scanners). Now that generated posts carry canonical CTAs (apps/web/lib/
-- blog-cta.ts), we want per-ARTICLE conversion: for each /blog/<slug> (or
-- /clone-watch page) a reader first landed on, how many went on to complete a
-- scan or submit a contact. Attribution is first-touch: a reader's landing_path
-- is their first session's page, and their later conversions are joined by
-- anonymous_id. No UTMs on internal links needed — landing_path is the key.
--
-- security_invoker so RLS/permissions are the caller's (service role for
-- /admin/analytics), matching the v190 views.

BEGIN;

CREATE OR REPLACE VIEW public.content_post_funnel
  WITH (security_invoker = on) AS
WITH readers AS (
  SELECT anonymous_id, landing_path
  FROM public.visitors
  WHERE landing_path LIKE '/blog/%'
     OR landing_path LIKE '/clone-watch%'
),
scanners AS (
  SELECT DISTINCT anonymous_id FROM public.analytics_events
  WHERE event_type = 'scan_completed'
),
contacts AS (
  SELECT DISTINCT anonymous_id FROM public.analytics_events
  WHERE event_type = 'contact_submit'
)
SELECT r.landing_path,
       count(DISTINCT r.anonymous_id) AS readers,
       count(DISTINCT r.anonymous_id) FILTER (WHERE s.anonymous_id IS NOT NULL)
         AS readers_who_scanned,
       count(DISTINCT r.anonymous_id) FILTER (WHERE c.anonymous_id IS NOT NULL)
         AS readers_who_contacted
FROM readers r
LEFT JOIN scanners s USING (anonymous_id)
LEFT JOIN contacts c USING (anonymous_id)
GROUP BY r.landing_path
ORDER BY readers DESC;

COMMIT;
