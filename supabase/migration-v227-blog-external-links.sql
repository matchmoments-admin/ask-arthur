-- Migration v227: blog_external_links — curated "Further reading" links on blog posts
--
-- Editorially curated external related articles rendered at the bottom of
-- /blog/[slug]. Text cards only (no thumbnails — hotlinking/copyright/CSP).
-- Every link defaults to rel="nofollow"; 'sponsored' is reserved for any
-- future paid/affiliate placement (none exist today). `origin` is the audit
-- trail for the curation policy: what we chose editorially vs what arrived
-- via outreach email or a partnership.
--
-- Cold, tiny, manually-curated table (a handful of rows per post at most):
-- no hot-table chunking or index-budget concerns. Service-role only — all
-- reads happen server-side through createServiceClient(), same posture as
-- blog_posts.

CREATE TABLE IF NOT EXISTS blog_external_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id bigint NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL,
  source_name text NOT NULL,
  description text,
  rel text NOT NULL DEFAULT 'nofollow' CHECK (rel IN ('nofollow', 'sponsored')),
  origin text NOT NULL DEFAULT 'editorial' CHECK (origin IN ('editorial', 'outreach', 'partnership')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, url)
);

CREATE INDEX IF NOT EXISTS idx_blog_external_links_post
  ON blog_external_links (post_id, is_active, sort_order);

ALTER TABLE blog_external_links ENABLE ROW LEVEL SECURITY;

-- Service-role only: no anon/authenticated policies. RLS on with no policies
-- denies everything except the service key, which bypasses RLS.
