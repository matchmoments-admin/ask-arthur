-- migration-v136: shop_checks CHECK constraints — Shop Signal Stage 1 PR B.
--
-- Two range/enum guards the v135 schema (#320) left off, caught by the
-- Stage 1 PR B review:
--   1. composite_score is documented "0-100" but was an unbounded SMALLINT
--      — a caller bug could silently persist an out-of-range score.
--   2. referrer_source had no CHECK while its sibling source_surface does;
--      only the four ReferrerSource enum values are ever valid.
--
-- shop_checks is currently empty (forward-only; nothing writes to it until
-- the #321 Inngest fan-out lands), so ADD CONSTRAINT validates instantly.
--
-- No feature_brakes seed row: feature_brakes is created on-demand by the
-- cost-daily-check upsert (paused_until is NOT NULL, so a "null = inactive"
-- seed is impossible), exactly as phone_footprint / reddit_intel / charity_check
-- already do — none of them pre-seed a row either.
--
-- Fully idempotent (DROP CONSTRAINT IF EXISTS before ADD) so re-applying is safe.
--
-- Plan: docs/plans/shop-guard-v2.md §4 PR 2. Issue #319.

ALTER TABLE public.shop_checks
  DROP CONSTRAINT IF EXISTS shop_checks_composite_score_range;
ALTER TABLE public.shop_checks
  ADD CONSTRAINT shop_checks_composite_score_range
  CHECK (composite_score BETWEEN 0 AND 100);

ALTER TABLE public.shop_checks
  DROP CONSTRAINT IF EXISTS shop_checks_referrer_source_enum;
ALTER TABLE public.shop_checks
  ADD CONSTRAINT shop_checks_referrer_source_enum
  CHECK (referrer_source IS NULL OR referrer_source IN
    ('instagram-inapp','tiktok-inapp','facebook-inapp','whatsapp-inapp'));
