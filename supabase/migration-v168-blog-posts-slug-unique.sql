-- v168 — Make blog_posts.slug UNIQUE so the weekly-blog cron can upsert
-- idempotently (ON CONFLICT (slug)) instead of accumulating duplicate draft
-- rows on a cron retry or repeated trigger.
--
-- Born from the /ultracode audit (2026-05-30): apps/web/app/api/cron/weekly-blog
-- used a bare `.insert()` with no onConflict, so any retry/duplicate trigger
-- created another draft row for the same generated slug.
--
-- Precondition: no duplicate slugs currently exist. Verify before applying:
--   SELECT slug, count(*) FROM public.blog_posts GROUP BY slug HAVING count(*) > 1;
-- blog_posts is small + low-write, so a plain (non-CONCURRENTLY) unique index
-- is fine. Idempotent — safe to re-run.

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_slug_key
  ON public.blog_posts (slug);

-- The pre-existing non-unique idx_blog_posts_slug (v2) is now redundant: the
-- unique index serves the same equality lookups. Drop it to avoid maintaining
-- two indexes on the same column.
DROP INDEX IF EXISTS public.idx_blog_posts_slug;
