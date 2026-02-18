-- Ask Arthur v4 Migration — Phase 1: Media Analysis Infrastructure
-- Creates the media_analyses table for audio upload + transcription pipeline.
-- Phase 2 (migration-v5) depends on this table and the named constraint `media_type_check`.

-- ============================================================
-- 1. Media analyses table
-- ============================================================
CREATE TABLE IF NOT EXISTS media_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'audio',
  status TEXT NOT NULL DEFAULT 'pending',
  transcript TEXT,
  verdict TEXT,
  confidence REAL,
  summary TEXT,
  red_flags JSONB DEFAULT '[]',
  next_steps JSONB DEFAULT '[]',
  scam_type TEXT,
  channel TEXT,
  impersonated_brand TEXT,
  injection_detected BOOLEAN DEFAULT FALSE,

  -- Phase 2 nullable columns (populated by deepfake/phone intelligence)
  deepfake_score REAL,
  deepfake_provider TEXT,
  deepfake_raw JSONB,
  phone_numbers JSONB DEFAULT '[]',

  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Named constraint so migration-v5 can DROP CONSTRAINT media_type_check
ALTER TABLE media_analyses ADD CONSTRAINT media_type_check
  CHECK (media_type IN ('audio'));

-- Status lifecycle constraint
ALTER TABLE media_analyses ADD CONSTRAINT media_status_check
  CHECK (status IN ('pending', 'transcribing', 'analyzing', 'complete', 'error'));

-- ============================================================
-- 2. Row Level Security — service role only
-- ============================================================
ALTER TABLE media_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage media analyses"
  ON media_analyses FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_media_analyses_job_id
  ON media_analyses (job_id);

CREATE INDEX IF NOT EXISTS idx_media_analyses_active_status
  ON media_analyses (status)
  WHERE status NOT IN ('complete', 'error');

CREATE INDEX IF NOT EXISTS idx_media_analyses_created_at
  ON media_analyses (created_at);

-- ============================================================
-- 4. Auto-update trigger on updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_media_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_media_analyses_updated_at
  BEFORE UPDATE ON media_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_media_analyses_updated_at();
