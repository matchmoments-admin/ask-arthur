-- migration-v243-flagged-ads-impersonated-brand.sql
--
-- Adds a generic impersonated-brand tag to flagged_ads.
--
-- WHY: the extension's Facebook ad-scan path (analyze-ad) only ever persisted
-- the impersonated brand when it matched a row in monitored_celebrities
-- (deepfake_detections is celebrity-keyed). A non-celebrity brand impersonation
-- — a bank, a super fund, a retailer — left NO brand tag anywhere, so the
-- Scam-Ad Observatory flywheel would farm nothing the day the feature goes
-- live. These columns capture the impersonated brand on every non-SAFE ad:
--   • impersonated_brand      — Claude's raw free-text brand string (nullable)
--   • impersonated_brand_key  — brandNormalize() canonical key (the v174 join
--                               key), so ad telemetry can join the other brand
--                               streams (clone-watch / stewardship) later.
--
-- No index: flagged_ads is low-volume and the feature is still dark
-- (NEXT_PUBLIC_FF_FACEBOOK_ADS off); an index earns nothing yet and would just
-- dirty pages on every upsert. Add one alongside the first query that needs it.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Reverse:
--   ALTER TABLE public.flagged_ads
--     DROP COLUMN IF EXISTS impersonated_brand,
--     DROP COLUMN IF EXISTS impersonated_brand_key;

ALTER TABLE public.flagged_ads
  ADD COLUMN IF NOT EXISTS impersonated_brand     TEXT,
  ADD COLUMN IF NOT EXISTS impersonated_brand_key TEXT;

COMMENT ON COLUMN public.flagged_ads.impersonated_brand IS
  'Free-text brand the ad impersonates, from Claude analysis (analysis.impersonatedBrand). Written on every non-SAFE ad, independent of any monitored_celebrities match. (v243)';
COMMENT ON COLUMN public.flagged_ads.impersonated_brand_key IS
  'Canonical brand join key = brandNormalize(impersonated_brand) (the v174 alias-layer normaliser: lowercase, strip to [a-z0-9]). Lets scam-ad telemetry join the clone-watch / stewardship brand streams. (v243)';
