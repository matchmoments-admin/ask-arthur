-- v204 — Brand Protection subscription plans
--        (Wave 3 of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: the paid Brand Monitor tiers + the sales-led partnership pilot (first
-- target: police, at a custom ~A$300/mo) need to be recordable in the
-- subscriptions.plan column. v57 constrained plan to the API/extension/mobile
-- set; this extends the CHECK additively. Mirrors SubscriptionPlanSchema in
-- packages/types/src/billing.ts (kept in sync). Idempotent.
--
-- The pilot is provisioned MANUALLY (billing_provider='manual') — never public
-- self-serve — so a partnership can be recorded the moment a deal is signed,
-- with a takedown/telemetry trail, without wiring self-serve Stripe first.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
    CHECK (plan IN (
      'pro', 'business', 'enterprise', 'extension_pro', 'mobile_premium', 'bot_premium',
      -- Brand Protection (v204)
      'brand_monitor', 'brand_monitor_plus', 'brand_enterprise', 'brand_pilot'
    ));
