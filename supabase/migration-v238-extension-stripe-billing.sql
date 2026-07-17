-- Migration v238: extension_subscriptions → Stripe billing + account linking
-- Extension-monetisation PR 5 (docs/plans/extension-monetisation.md).
--
-- v34 created extension_subscriptions Paddle-shaped, keyed only on the
-- anonymous install_id, with no RLS and no provisioning path. This migration:
--   1. adds user_id (the install↔account link written by /api/extension/link)
--      and the stripe_* columns the webhook's extension_pro branch (PR 6)
--      upserts;
--   2. keeps the paddle_* columns (never used; dropping is a separate,
--      deliberate cleanup) and records the provider per row instead;
--   3. enables RLS with a service-role-only policy — closes the v34 gap
--      (every access path is service-role: extension routes, webhook, RPC is
--      SECURITY DEFINER).
-- get_extension_tier is intentionally untouched: it reads only
-- tier/status/current_period_end, all unchanged.

ALTER TABLE extension_subscriptions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_provider TEXT NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;

-- CHECK + UNIQUE added separately so re-running is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'extension_subscriptions_billing_provider_check'
  ) THEN
    ALTER TABLE extension_subscriptions
      ADD CONSTRAINT extension_subscriptions_billing_provider_check
      CHECK (billing_provider IN ('stripe', 'paddle', 'manual'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_subs_stripe_sub
  ON extension_subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ext_subs_user
  ON extension_subscriptions (user_id)
  WHERE user_id IS NOT NULL;

-- RLS: service-role only (matches deepfake_detections_service_all pattern).
ALTER TABLE extension_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "extension_subscriptions_service_all" ON extension_subscriptions;
CREATE POLICY "extension_subscriptions_service_all" ON extension_subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
