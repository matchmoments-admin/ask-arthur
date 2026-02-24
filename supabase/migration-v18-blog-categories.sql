-- ============================================================
-- migration-v18-blog-categories.sql
-- Blog redesign: categories table, product column, full-text search
-- ============================================================

-- Categories table
CREATE TABLE IF NOT EXISTS blog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE blog_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read blog categories"
  ON blog_categories FOR SELECT USING (true);
CREATE POLICY "Service role manages blog categories"
  ON blog_categories FOR ALL USING (auth.role() = 'service_role');

-- Seed initial categories
INSERT INTO blog_categories (name, slug, description, sort_order) VALUES
  ('Scam Alerts', 'scam-alerts', 'Weekly threat intelligence from real scams detected across Australia', 1),
  ('Guides', 'guides', 'Step-by-step protection guides for common scam types', 2),
  ('Product', 'product', 'New features and platform updates across Web, App, API, and bots', 3),
  ('Security', 'security', 'Technical security advisories and best practices', 4)
ON CONFLICT (slug) DO NOTHING;

-- Add new columns to blog_posts
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS category_slug TEXT REFERENCES blog_categories(slug);
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS product TEXT;

-- Migrate existing category values to new category_slug
UPDATE blog_posts SET category_slug = CASE
  WHEN category = 'scam-alerts' THEN 'scam-alerts'
  WHEN category = 'weekly-roundup' THEN 'scam-alerts'
  WHEN category = 'guides' THEN 'guides'
  WHEN category = 'news' THEN 'product'
  WHEN category = 'platform-safety' THEN 'security'
  ELSE 'scam-alerts'
END
WHERE category_slug IS NULL;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_blog_posts_category_slug ON blog_posts (category_slug, published_at DESC);
DROP INDEX IF EXISTS idx_blog_posts_featured;
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured ON blog_posts (is_featured, published_at DESC) WHERE is_featured = TRUE;

-- Full-text search index
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_blog_posts_search ON blog_posts USING GIN (search_vector);
