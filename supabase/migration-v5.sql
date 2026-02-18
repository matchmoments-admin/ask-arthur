-- Ask Arthur v5 Migration — Phase 2: Deepfake Detection + Phone Intelligence
-- Prerequisite: migration-v4.sql (Phase 1) must be applied first.
-- Phase 1 creates the media_analyses table with nullable Phase 2 columns.

-- ============================================================
-- 1. Index for deepfake queries (Phase 2 column populated)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_media_analyses_deepfake
  ON media_analyses (deepfake_score)
  WHERE deepfake_score IS NOT NULL;

-- ============================================================
-- 2. Phone number intelligence results (one-to-many from media_analyses)
-- ============================================================
CREATE TABLE IF NOT EXISTS phone_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES media_analyses(id) ON DELETE CASCADE,
  phone_number_scrubbed TEXT NOT NULL,     -- Last 3 digits only: "********123"
  country_code TEXT,                        -- "AU"
  line_type TEXT,                           -- "mobile" | "landline" | "nonFixedVoip" | "tollFree"
  carrier TEXT,                            -- "Telstra" | "Optus" | etc.
  is_voip BOOLEAN DEFAULT FALSE,           -- VoIP numbers are disproportionately used by scammers
  risk_flags JSONB DEFAULT '[]',           -- e.g. ["voip", "unknown_carrier", "non_au_origin"]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: service role only (consistent with media_analyses)
ALTER TABLE phone_lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage phone lookups"
  ON phone_lookups FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_phone_lookups_analysis ON phone_lookups(analysis_id);

-- ============================================================
-- 3. Expand media_type constraint to include video
-- ============================================================
-- Phase 1 may have added a CHECK constraint on media_type.
-- This widens it to allow 'video' as well.
-- If the constraint doesn't exist yet, this is a no-op.
DO $$
BEGIN
  -- Drop existing constraint if present
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'media_type_check'
  ) THEN
    ALTER TABLE media_analyses DROP CONSTRAINT media_type_check;
  END IF;

  -- Add widened constraint
  ALTER TABLE media_analyses ADD CONSTRAINT media_type_check
    CHECK (media_type IN ('audio', 'video'));
EXCEPTION
  WHEN undefined_table THEN
    -- media_analyses doesn't exist yet (Phase 1 not applied) — skip
    RAISE NOTICE 'media_analyses table not found — skipping constraint update';
END;
$$;
