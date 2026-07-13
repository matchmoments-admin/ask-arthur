-- migration-v229-analytics-pageview-path-index.sql
-- Partial index to make per-path pageview counts a cheap index-only scan.
--
-- WHY: the blog post page now renders a first-party view count
-- (getPostViewCount → count(*) FROM analytics_events WHERE event_type =
-- 'pageview' AND path = '/blog/<slug>'). The existing index is on
-- (event_type, created_at DESC), which does not help a path filter — the
-- count would degrade to a filtered scan as pageview rows accumulate. A
-- partial btree on path, restricted to pageview rows, keeps the count fast
-- and stays tiny (only pageview events are indexed, not the whole table).
--
-- analytics_events is append-only and not in the hot write-frequent table set,
-- so a plain (non-CONCURRENT) CREATE INDEX is safe here.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_analytics_events_pageview_path
  ON public.analytics_events (path)
  WHERE event_type = 'pageview';

COMMIT;
