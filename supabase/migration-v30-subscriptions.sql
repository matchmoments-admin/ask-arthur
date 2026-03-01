-- Migration v30: Paddle subscription billing for B2B API tiers.
-- Adds subscriptions table, updates api_keys defaults, and sync RPC.

-- =============================================================================
-- Table: subscriptions — Paddle subscription records linked to api_keys
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id              BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  user_id                 UUID,
  paddle_subscription_id  TEXT UNIQUE NOT NULL,
  paddle_customer_id      TEXT NOT NULL,
  paddle_price_id         TEXT NOT NULL,
  plan                    TEXT NOT NULL CHECK (plan IN ('pro', 'enterprise')),
  status                  TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'past_due', 'canceled', 'paused', 'trialing')),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at               TIMESTAMPTZ,
  canceled_at             TIMESTAMPTZ,
  paused_at               TIMESTAMPTZ,
  billing_email           TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_subscriptions_api_key_id
  ON subscriptions (api_key_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_sub_id
  ON subscriptions (paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_customer_id
  ON subscriptions (paddle_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions (status);

-- =============================================================================
-- RLS: service-role only (same pattern as api_usage_log in v25)
-- =============================================================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access subscriptions" ON subscriptions
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- Update api_keys defaults for new free tier (25 requests/day)
-- =============================================================================
ALTER TABLE api_keys ALTER COLUMN daily_limit SET DEFAULT 25;

-- Backfill existing free-tier keys from 100 → 25
UPDATE api_keys SET daily_limit = 25 WHERE tier = 'free' AND daily_limit = 100;

-- =============================================================================
-- RPC: sync_subscription_tier — atomically update api_keys based on subscription
-- =============================================================================
CREATE OR REPLACE FUNCTION sync_subscription_tier(
  p_api_key_id BIGINT,
  p_plan TEXT,
  p_status TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tier TEXT;
  v_daily_limit INT;
  v_rpm INT;
  v_batch_size INT;
BEGIN
  -- If subscription is active/trialing, apply the plan's limits.
  -- Otherwise, downgrade to free tier.
  IF p_status IN ('active', 'trialing') THEN
    v_tier := p_plan;
    IF p_plan = 'enterprise' THEN
      v_daily_limit := 5000;
      v_rpm := 300;
      v_batch_size := 500;
    ELSE
      -- pro
      v_daily_limit := 100;
      v_rpm := 60;
      v_batch_size := 100;
    END IF;
  ELSE
    -- canceled, past_due, paused → downgrade to free
    v_tier := 'free';
    v_daily_limit := 25;
    v_rpm := 60;
    v_batch_size := 10;
  END IF;

  UPDATE api_keys
  SET tier = v_tier,
      daily_limit = v_daily_limit,
      rate_limit_per_minute = v_rpm,
      max_batch_size = v_batch_size
  WHERE id = p_api_key_id;
END;
$$;
