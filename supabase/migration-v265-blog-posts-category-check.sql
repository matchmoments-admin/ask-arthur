-- v265: re-align blog_posts_category_check with the live blog_categories slugs.
--
-- The 2026-07-14 category cleanup updated blog_categories and the app-side
-- VALID_CATEGORIES list (apps/web/lib/monthly-intel-blog.ts) but never this
-- CHECK constraint, which still enforced the original launch list
-- ('weekly-roundup','scam-alerts','guides','platform-safety','news').
-- Result: the monthly-intel-blog fallback upsert violated the constraint on
-- category='intelligence' (2026-08-07 canary, Inngest run at 20:05Z) and the
-- month's draft was lost. The app validates against blog_categories slugs
-- with a 'scam-alerts' fallback; this constraint now matches that source of
-- truth, keeping the legacy values so existing rows stay valid.
--
-- Idempotent: DROP IF EXISTS + ADD.

ALTER TABLE public.blog_posts
  DROP CONSTRAINT IF EXISTS blog_posts_category_check;

ALTER TABLE public.blog_posts
  ADD CONSTRAINT blog_posts_category_check
  CHECK (category = ANY (ARRAY[
    -- live blog_categories slugs (source of truth):
    'compliance'::text,
    'guides'::text,
    'intelligence'::text,
    'product'::text,
    'real-stories'::text,
    'scam-alerts'::text,
    'security'::text,
    -- legacy values kept so pre-cleanup rows remain valid:
    'weekly-roundup'::text,
    'platform-safety'::text,
    'news'::text
  ]));
