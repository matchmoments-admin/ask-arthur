-- migration-v192-analytics-event-daily.sql
-- Per-day, per-type event-count primitive for the /admin/analytics funnel.
--
-- WHY: the dashboard needs windowed counts across event types (scan_started →
-- scan_completed | scan_failed → scam_report_submitted → contact_submit) to
-- render the scan funnel + error rate. The Supabase JS client can't GROUP BY
-- inline, so this view is the grouped primitive (same shape as daily_scans,
-- reusable for any future event trend). security_invoker like the other v190/
-- v191 analytics views.

BEGIN;

CREATE OR REPLACE VIEW public.analytics_event_daily
  WITH (security_invoker = on) AS
SELECT date_trunc('day', created_at)::date AS day,
       event_type,
       count(*) AS events
FROM public.analytics_events
GROUP BY 1, 2
ORDER BY 1 DESC;

COMMIT;
