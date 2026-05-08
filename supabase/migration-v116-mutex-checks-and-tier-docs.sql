-- Migration v116: mutex CHECKs on dual-owner tables (Phase 7.0) +
-- tier-duplication documentation (Phase 4.6)
--
-- Three families of changes, all defensive / additive, zero behaviour change:
--
-- 1. Phase 7.0 — Mutual-exclusion CHECKs on the four dual-owner tables
--    that have user_id + org_id columns but no constraint enforcing
--    "exactly one of them is set". This pattern is already enforced on
--    phone_footprint_monitors (pfm_single_owner), phone_footprint_entitlements
--    (pfe_single_owner), and sim_swap_monitors (ssm_single_owner). The
--    four tables that LACK it (verified 2026-05-08):
--      - api_keys
--      - phone_footprints
--      - telco_api_usage
--      - telco_webhook_subscriptions
--
--    org_members is intentionally excluded — it's the M:N junction table
--    where BOTH user_id AND org_id are NOT NULL by design.
--
--    Pre-flight: 0 violations on all four tables in production today.
--    The CHECKs land as immediate-VALID since no existing data fails.
--
--    Insert paths that today set both columns (none observed) would
--    fail after this migration; insert paths that set NEITHER (none
--    observed) would also fail. service_role can still bypass RLS but
--    cannot bypass CHECK constraints — defensive against future code
--    that forgets the invariant.
--
-- 2. Phase 4.6 — Tier-duplication documentation. The session audit
--    confirmed that user_profiles.tier DOES NOT EXIST (the v2 plan
--    incorrectly listed it); it's actually duplication between
--    api_keys.tier and subscriptions.plan, kept in sync via
--    sync_subscription_tier() RPC called from the Stripe webhook
--    (apps/web/app/api/stripe/webhook/route.ts:208).
--
--    This migration adds a COMMENT ON COLUMN documenting the
--    canonical-source-of-truth invariant so future developers don't
--    introduce a third writer.
--
-- 3. No data changes. Idempotent (DROP CONSTRAINT IF NOT EXISTS pattern
--    via DO block).

-- ─── 1. Phase 7.0 mutex CHECKs ──────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.api_keys'::regclass
                   AND conname = 'api_keys_single_owner') THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_single_owner
      CHECK ((user_id IS NOT NULL AND org_id IS NULL)
          OR (user_id IS NULL AND org_id IS NOT NULL));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.phone_footprints'::regclass
                   AND conname = 'phone_footprints_single_owner') THEN
    ALTER TABLE public.phone_footprints
      ADD CONSTRAINT phone_footprints_single_owner
      CHECK ((user_id IS NOT NULL AND org_id IS NULL)
          OR (user_id IS NULL AND org_id IS NOT NULL));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.telco_api_usage'::regclass
                   AND conname = 'telco_api_usage_single_owner') THEN
    ALTER TABLE public.telco_api_usage
      ADD CONSTRAINT telco_api_usage_single_owner
      CHECK ((user_id IS NOT NULL AND org_id IS NULL)
          OR (user_id IS NULL AND org_id IS NOT NULL));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.telco_webhook_subscriptions'::regclass
                   AND conname = 'telco_webhook_subscriptions_single_owner') THEN
    ALTER TABLE public.telco_webhook_subscriptions
      ADD CONSTRAINT telco_webhook_subscriptions_single_owner
      CHECK ((user_id IS NOT NULL AND org_id IS NULL)
          OR (user_id IS NULL AND org_id IS NOT NULL));
  END IF;
END $$;

-- ─── 2. Phase 4.6 tier-duplication documentation ───────────────────────

COMMENT ON COLUMN public.api_keys.tier IS
  'API key tier (free|pro|business|enterprise|custom). DERIVED COLUMN: '
  'kept in sync from subscriptions.plan via sync_subscription_tier() RPC '
  'called from /api/stripe/webhook/route.ts on customer.subscription.* '
  'events. DO NOT WRITE TO THIS COLUMN DIRECTLY. The canonical source of '
  'truth is subscriptions.plan (Stripe-authoritative). user_profiles has '
  'NO tier column despite what the v2 data-model plan claimed — this is '
  'duplication, not triplication.';

COMMENT ON COLUMN public.subscriptions.plan IS
  'Stripe subscription plan (pro|business|enterprise|extension_pro|'
  'mobile_premium|bot_premium). CANONICAL TIER SOURCE OF TRUTH. '
  'Written by /api/stripe/webhook/route.ts on customer.subscription.* '
  'events; sync_subscription_tier() RPC propagates to api_keys.tier.';

-- ─── Verification (run manually after apply) ───────────────────────────
-- SELECT tablename, conname FROM pg_constraint c
-- JOIN pg_class t ON t.oid = c.conrelid
-- WHERE c.contype = 'c' AND conname LIKE '%single_owner%'
-- ORDER BY tablename;
--   → 7 constraints across api_keys, phone_footprints,
--     phone_footprint_monitors, phone_footprint_entitlements,
--     sim_swap_monitors, telco_api_usage, telco_webhook_subscriptions.
--
-- Expected post-apply behaviour:
-- INSERT INTO api_keys (user_id, org_id, ...) VALUES (uid, oid, ...);
--   → ERROR: violates check constraint api_keys_single_owner
