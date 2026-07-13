-- Migration v228: make the Ghost mirror upsert actually work
--
-- v74 created idx_blog_posts_ghost_post_id as a PARTIAL unique index
-- (WHERE ghost_post_id IS NOT NULL). PostgREST's
-- upsert(..., { onConflict: "ghost_post_id" }) emits
-- ON CONFLICT (ghost_post_id) without the predicate, which Postgres cannot
-- match to a partial index -> 42P10 on every webhook delivery. Result: the
-- Ghost -> blog_posts mirror has silently failed since v74 (surfaced
-- 2026-07-13 when the first machine-authored post was published from Ghost;
-- founder posts had been seeded directly so nothing ever hit this path).
--
-- Fix: a full unique constraint. Postgres unique constraints treat NULLs as
-- distinct, so the many legacy rows with ghost_post_id IS NULL remain valid —
-- the partial predicate was never needed.

DROP INDEX IF EXISTS idx_blog_posts_ghost_post_id;

ALTER TABLE blog_posts
  DROP CONSTRAINT IF EXISTS blog_posts_ghost_post_id_key;

ALTER TABLE blog_posts
  ADD CONSTRAINT blog_posts_ghost_post_id_key UNIQUE (ghost_post_id);
