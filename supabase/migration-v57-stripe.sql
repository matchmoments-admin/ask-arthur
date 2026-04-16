-- Migration v57: Stripe billing migration.
-- Adds Stripe fields to user_profiles and subscriptions, makes Paddle
-- columns nullable, updates tier limits for new pricing.

-- =============================================================================
-- Add stripe_customer_id to user_profiles
-- =============================================================================
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer
  ON user_profiles (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- =============================================================================
-- Add Stripe columns to subscriptions (keep Paddle columns for history)
-- =============================================================================
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id         TEXT,
  ADD COLUMN IF NOT EXISTS billing_provider        TEXT NOT NULL DEFAULT 'paddle'
    CHECK (billing_provider IN ('paddle', 'stripe', 'manual'));

-- Make Paddle columns nullable for new Stripe records
ALTER TABLE subscriptions
  ALTER COLUMN paddle_subscription_id DROP NOT NULL,
  ALTER COLUMN paddle_customer_id     DROP NOT NULL,
  ALTER COLUMN paddle_price_id        DROP NOT NULL;

-- Update plan enum to include 'business' tier
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check
    CHECK (plan IN ('pro', 'business', 'enterprise', 'extension_pro', 'mobile_premium', 'bot_premium'));

-- Update api_keys tier enum to include 'business'
ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_tier_check;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_tier_check
    CHECK (tier IN ('free', 'pro', 'business', 'enterprise', 'custom'));

-- Indexes for Stripe lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub
  ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- =============================================================================
-- Update sync_subscription_tier RPC with new pricing limits
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
  IF p_status IN ('active', 'trialing') THEN
    v_tier := p_plan;
    CASE p_plan
      WHEN 'pro' THEN
        v_daily_limit := 200;
        v_rpm := 120;
        v_batch_size := 100;
      WHEN 'business' THEN
        v_daily_limit := 2000;
        v_rpm := 300;
        v_batch_size := 500;
      WHEN 'enterprise' THEN
        v_daily_limit := 10000;
        v_rpm := 500;
        v_batch_size := 2000;
      ELSE
        -- Unknown plan, default to pro limits
        v_daily_limit := 200;
        v_rpm := 120;
        v_batch_size := 100;
    END CASE;
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
