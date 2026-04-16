-- v59: Remove Paddle billing columns (migrated to Stripe)
-- All subscriptions are now Stripe-only.

-- Drop Paddle-specific columns from subscriptions
ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS paddle_subscription_id,
  DROP COLUMN IF EXISTS paddle_customer_id,
  DROP COLUMN IF EXISTS paddle_price_id;

-- Drop billing_provider column (no longer needed — Stripe only)
ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS billing_provider;

-- Drop the old Paddle constraint if it exists
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_provider_check;
