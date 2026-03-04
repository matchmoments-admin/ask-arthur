-- Migration v34: Extension subscription mapping
-- Phase C4: Freemium payment gate for Chrome extension

CREATE TABLE IF NOT EXISTS extension_subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  install_id TEXT NOT NULL UNIQUE,
  paddle_subscription_id TEXT UNIQUE,
  paddle_customer_id TEXT,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'paused')),
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ext_subs_install
  ON extension_subscriptions (install_id);

CREATE INDEX IF NOT EXISTS idx_ext_subs_paddle
  ON extension_subscriptions (paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

-- RPC to check extension subscription tier
CREATE OR REPLACE FUNCTION get_extension_tier(p_install_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tier TEXT;
BEGIN
  SELECT tier INTO v_tier
  FROM extension_subscriptions
  WHERE install_id = p_install_id
    AND status = 'active'
    AND (current_period_end IS NULL OR current_period_end > now());

  RETURN COALESCE(v_tier, 'free');
END;
$$;
