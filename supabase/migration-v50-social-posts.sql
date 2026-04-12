-- migration-v50: Social post drafts for brand impersonation alerts

ALTER TABLE brand_impersonation_alerts
  ADD COLUMN IF NOT EXISTS draft_post_short TEXT,
  ADD COLUMN IF NOT EXISTS draft_post_long TEXT,
  ADD COLUMN IF NOT EXISTS twitter_post_id TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_post_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_post_id TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
