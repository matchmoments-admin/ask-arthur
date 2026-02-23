-- migration-v15-blog-upgrade.sql
-- Blog upgrade: status column, categories, reading time, featured, SEO fields

-- status column (replaces published boolean)
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS status TEXT
  DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived'));
UPDATE blog_posts SET status = CASE WHEN published = TRUE THEN 'published' ELSE 'draft' END
WHERE status IS NULL OR status = 'draft';

-- New columns
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS hero_image_url TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS hero_image_alt TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS subtitle TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS reading_time_minutes INT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS category TEXT
  DEFAULT 'weekly-roundup' CHECK (category IN (
    'weekly-roundup', 'scam-alerts', 'guides', 'platform-safety', 'news'));
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS meta_description TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS meta_image_url TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

-- Backfill reading_time_minutes from content word count (~200 wpm)
UPDATE blog_posts SET reading_time_minutes = GREATEST(1,
  ROUND(array_length(regexp_split_to_array(content, '\s+'), 1) / 200.0)::INT)
WHERE reading_time_minutes IS NULL;

-- Update RLS: swap published boolean for status text
DROP POLICY IF EXISTS "Public can read published blog posts" ON blog_posts;
CREATE POLICY "Public can read published blog posts"
  ON blog_posts FOR SELECT USING (status = 'published');

-- New indexes
DROP INDEX IF EXISTS idx_blog_posts_published;
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts (category, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured ON blog_posts (is_featured) WHERE is_featured = TRUE;
