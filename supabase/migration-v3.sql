-- Ask Arthur v3 Migration
-- Spam Act compliance + blog guardrails

-- ============================================================
-- 1. Consent tracking on email_subscribers
-- ============================================================
ALTER TABLE email_subscribers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE email_subscribers ADD COLUMN IF NOT EXISTS consent_source TEXT;

-- ============================================================
-- 2. Source scam IDs on blog_posts (for grounding)
-- ============================================================
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS source_scam_ids BIGINT[];
