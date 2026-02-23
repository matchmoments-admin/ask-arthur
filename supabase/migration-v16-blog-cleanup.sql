-- migration-v16-blog-cleanup.sql
-- Drop legacy published boolean column after all code paths use status
-- Only run after verifying all queries use status instead of published

ALTER TABLE blog_posts DROP COLUMN IF EXISTS published;
