-- Migration v225: lower entity-enrichment threshold to report_count >= 2
-- (fleet-review D2 follow-up — 2026-07-13).
--
-- Context. PR #726 lowered the entity-enrichment + urlscan-enrichment WORKLIST
-- queries from `report_count >= 3` to `>= 2` to activate the data-starved
-- intelligence-core stages (URL/email entities never reached 3; corpus max = 2).
-- But the v23 promote-trigger + partial index still gated at `>= 3`, so entities
-- at report_count = 2 stayed `enrichment_status = 'none'` and were never promoted
-- into the `pending` worklist — the query change alone was a no-op. The
-- post-deploy smoke test caught this (6 rc=2 entities sitting at status 'none').
--
-- This aligns the trigger + partial index with the lowered threshold and
-- backfills the existing rows. Idempotent (CREATE OR REPLACE / IF EXISTS).

-- 1. Promote-trigger: fire when report_count crosses 2 (was 3).
CREATE OR REPLACE FUNCTION trigger_entity_enrichment_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.report_count >= 2 AND OLD.report_count < 2 AND OLD.enrichment_status = 'none' THEN
    NEW.enrichment_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Partial index at >= 2 so the lowered worklist query stays index-supported.
--    scam_entities is tiny (~136 rows), so the rebuild is instant; a small btree
--    partial index, same size class as the one it replaces (no IO-budget concern).
DROP INDEX IF EXISTS idx_scam_entities_enrichment_pending;
CREATE INDEX IF NOT EXISTS idx_scam_entities_enrichment_pending
  ON scam_entities (enrichment_status, report_count DESC)
  WHERE enrichment_status IN ('pending', 'failed') AND report_count >= 2;

-- 3. Backfill existing report_count >= 2 'none' entities into the worklist.
--    Small one-off (~6 rows); scam_entities is a hot table but this touches a
--    handful of rows, well under the 5K chunk threshold — no chunking needed.
UPDATE scam_entities
SET enrichment_status = 'pending'
WHERE enrichment_status = 'none' AND report_count >= 2;
