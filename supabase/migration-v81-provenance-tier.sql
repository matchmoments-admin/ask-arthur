-- Migration v81: provenance_tier enum + column on feed_items and scam_entities.
--
-- Banks evaluating Ask Arthur as a scam-intel enrichment layer need to filter
-- entities by source quality. The recent enrichment-layer review flagged the
-- "98% Reddit" optical as a credibility issue; with this column, API consumers
-- can request "tier 1 regulator-grade only" (or any combination), and the
-- dashboard can surface a tier-mix breakdown rather than a flat source list.
--
-- Five tiers, ordered by trust:
--   tier_1_regulator   — ASIC, NASC, Scamwatch, AFCX-confirmed bank intel
--   tier_2_industry    — Cifas-equivalent member contributions (future state)
--   tier_3_curated     — PhishTank verified, URLhaus, ACSC, verified_scams
--   tier_4_osint       — crt.sh, URLScan public, ThreatFox, OpenPhish
--   tier_5_community   — Reddit, user reports, unverified
--
-- feed_items is backfilled mechanically from the existing `source` column; for
-- scam_entities there's no source column on the row itself, so the column
-- stays nullable until producer code (Inngest jobs, RPCs) starts populating
-- it on insert. A future migration can derive scam_entities.provenance_tier
-- by looking up the highest-tier feed_item that references the entity.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'provenance_tier_t') THEN
    CREATE TYPE provenance_tier_t AS ENUM (
      'tier_1_regulator',
      'tier_2_industry',
      'tier_3_curated',
      'tier_4_osint',
      'tier_5_community'
    );
  END IF;
END$$;

ALTER TABLE feed_items
  ADD COLUMN IF NOT EXISTS provenance_tier provenance_tier_t;

ALTER TABLE scam_entities
  ADD COLUMN IF NOT EXISTS provenance_tier provenance_tier_t;

-- Backfill feed_items from existing source values. The WHERE provenance_tier
-- IS NULL guard makes the UPDATE idempotent — once a row is backfilled it
-- won't be re-backfilled if its source is later changed (operator intent:
-- source is the producer; tier is editorial).
UPDATE feed_items SET provenance_tier = 'tier_1_regulator'
  WHERE source = 'scamwatch' AND provenance_tier IS NULL;

UPDATE feed_items SET provenance_tier = 'tier_3_curated'
  WHERE source = 'verified_scam' AND provenance_tier IS NULL;

UPDATE feed_items SET provenance_tier = 'tier_5_community'
  WHERE source IN ('reddit', 'user_report') AND provenance_tier IS NULL;

COMMENT ON TYPE provenance_tier_t IS 'Five-tier source quality ladder, ordered by trust: tier_1_regulator, tier_2_industry, tier_3_curated, tier_4_osint, tier_5_community.';

COMMENT ON COLUMN feed_items.provenance_tier IS 'Source-quality tier for filtering and dashboard mix. Backfilled from `source` at v81 apply: scamwatch->tier_1_regulator, verified_scam->tier_3_curated, reddit/user_report->tier_5_community. New rows should set this explicitly.';

COMMENT ON COLUMN scam_entities.provenance_tier IS 'Source-quality tier. NULL means tier has not been set; producer code (Inngest enrichment, RPCs) should populate on insert. Future: derive from highest-tier feed_item that mentions this entity.';

CREATE INDEX IF NOT EXISTS idx_feed_items_provenance_tier
  ON feed_items (provenance_tier)
  WHERE provenance_tier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scam_entities_provenance_tier
  ON scam_entities (provenance_tier)
  WHERE provenance_tier IS NOT NULL;
