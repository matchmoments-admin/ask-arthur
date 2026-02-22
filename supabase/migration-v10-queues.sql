-- Ask Arthur v10 Migration — Bot Message Queue Architecture
-- Uses pgmq for reliable async processing of bot messages.
-- pg_cron processes the queue every 30 seconds.

-- ============================================================
-- 1. Enable pgmq extension (Supabase has this built-in)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgmq;

-- ============================================================
-- 2. Create the bot_messages queue via pgmq
-- ============================================================
SELECT pgmq.create('bot_messages');

-- ============================================================
-- 3. Bot message queue tracking table
--    Stores metadata alongside pgmq queue for observability.
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,          -- 'telegram' | 'whatsapp' | 'slack' | 'messenger'
  user_id TEXT NOT NULL,           -- Platform-specific user identifier
  message_text TEXT NOT NULL,
  images JSONB DEFAULT '[]',       -- Base64-encoded images (for WhatsApp image support)
  reply_to JSONB,                  -- Platform-specific reply metadata
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'completed' | 'failed'
  retries INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Status lifecycle constraint
ALTER TABLE bot_message_queue ADD CONSTRAINT bot_queue_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

-- ============================================================
-- 4. Row Level Security — service role only
-- ============================================================
ALTER TABLE bot_message_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage bot queue"
  ON bot_message_queue FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 5. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bot_queue_pending
  ON bot_message_queue (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_bot_queue_platform_user
  ON bot_message_queue (platform, user_id);

-- ============================================================
-- 6. pg_cron job — process queue every 30 seconds
--    Posts to the cron endpoint which dequeues and processes.
--    CRON_SECRET must be set in Supabase vault/env.
-- ============================================================
-- NOTE: Uncomment and configure after deploying the cron endpoint.
-- The URL and secret must match your deployment.
--
-- SELECT cron.schedule(
--   'process-bot-queue',
--   '30 seconds',
--   $$
--   SELECT net.http_post(
--     url := 'https://askarthur.au/api/cron/process-bot-queue',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
