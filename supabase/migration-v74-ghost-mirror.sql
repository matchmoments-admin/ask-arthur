-- v74 — Ghost blog mirror
--
-- Adds columns so blog_posts can be mirrored from Ghost (the new editor +
-- newsletter delivery surface, owned by the agent-fleet CMO + /publish flow).
-- Ghost is the source of truth; safeverify reads stay against Supabase so the
-- in-app /blog route keeps its design system, scam CTAs, OG cards, RSS, and
-- Plausible analytics. The mirror is one-way: Ghost → Supabase.
--
-- Idempotent — safe to re-run.

-- ghost_post_id: Ghost's stable internal id (e.g. "5f7e8fb1..."). Upsert key
-- for the webhook handler. Partial unique index — null for legacy markdown
-- rows that pre-date the mirror so they don't conflict.
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS ghost_post_id TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS ghost_uuid TEXT;

-- Last successful mirror write. Lets ops spot a stalled webhook by querying
-- MAX(ghost_synced_at) without trawling logs.
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS ghost_synced_at TIMESTAMPTZ;

-- Pre-rendered HTML from Ghost (`html` field in the webhook payload). The
-- existing `content` column stores Markdown for legacy posts and gets piped
-- through renderMarkdown(); for Ghost-mirrored rows we already have HTML, so
-- the page renderer prefers content_html when present and skips markdown
-- rendering. Both paths still pass through sanitizeHtml() before render.
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS content_html TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_ghost_post_id
  ON blog_posts (ghost_post_id) WHERE ghost_post_id IS NOT NULL;
