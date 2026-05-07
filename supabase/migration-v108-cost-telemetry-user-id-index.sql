-- Migration v108: index for cost_telemetry.user_id FK (follow-up to v102)
--
-- v102 added the cost_telemetry.user_id → auth.users(id) FK but didn't
-- index the referencing column. The Supabase performance advisor
-- flagged this as a new unindexed_foreign_keys finding (1 left after
-- v100 closed the previous 11). Without an index here, every
-- auth.users DELETE has to seq-scan cost_telemetry to enforce the FK.
--
-- Closes the residual unindexed_foreign_keys advisor → 0.

CREATE INDEX IF NOT EXISTS idx_cost_telemetry_user_id
  ON public.cost_telemetry (user_id)
  WHERE user_id IS NOT NULL;

-- Partial index because the column is nullable and ~most rows likely
-- have user_id IS NULL (cost_telemetry events are mostly system-level
-- — Inngest crons, scraper RPCs, etc., not user-initiated).
