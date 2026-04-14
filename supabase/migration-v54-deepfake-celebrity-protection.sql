-- ============================================================
-- v54: Deepfake Detection & Celebrity Protection Pipeline
-- ============================================================
-- Adds monitored_celebrities table, deepfake_detections table,
-- and new columns on flagged_ads for Hive AI results.
-- ============================================================

-- Enable pg_trgm for fuzzy celebrity name matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------
-- 1. Monitored Celebrities
-- -----------------------------------------------------------
CREATE TABLE monitored_celebrities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  aliases TEXT[] DEFAULT '{}',
  facebook_page_id TEXT,
  brp_enrolled BOOLEAN DEFAULT FALSE,
  contact_email TEXT,
  contact_name TEXT,
  detection_count INT DEFAULT 0,
  last_detected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE monitored_celebrities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monitored_celebrities_service_all" ON monitored_celebrities FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Seed data: commonly impersonated Australian public figures + Elon Musk
INSERT INTO monitored_celebrities (name, aliases, brp_enrolled) VALUES
  ('Andrew Forrest', ARRAY['Andrew "Twiggy" Forrest', 'Twiggy Forrest'], FALSE),
  ('Dick Smith', ARRAY['Richard Smith'], FALSE),
  ('David Koch', ARRAY['Kochie', 'David Koch AM'], FALSE),
  ('Gina Rinehart', ARRAY['Georgina Rinehart'], FALSE),
  ('Mike Cannon-Brookes', ARRAY['MCB', 'Mike Cannon Brookes'], FALSE),
  ('Scott Pape', ARRAY['Barefoot Investor', 'The Barefoot Investor'], FALSE),
  ('Chris Hemsworth', ARRAY['Hemsworth'], FALSE),
  ('Nicole Kidman', ARRAY[]::TEXT[], FALSE),
  ('Hugh Jackman', ARRAY[]::TEXT[], FALSE),
  ('Elon Musk', ARRAY['Musk'], FALSE);

-- Trigram index for fuzzy name matching
CREATE INDEX idx_monitored_celebrities_name_trgm
  ON monitored_celebrities USING gin (name gin_trgm_ops);

-- -----------------------------------------------------------
-- 2. Deepfake Detections
-- -----------------------------------------------------------
CREATE TABLE deepfake_detections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flagged_ad_id BIGINT REFERENCES flagged_ads(id) ON DELETE SET NULL,
  celebrity_id BIGINT REFERENCES monitored_celebrities(id) ON DELETE SET NULL,
  celebrity_name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  hive_result JSONB,
  ai_confidence NUMERIC(5, 4),
  deepfake_confidence NUMERIC(5, 4),
  generator_source TEXT,
  ad_text_excerpt TEXT,
  landing_url TEXT,
  advertiser_name TEXT,
  reported_to_meta BOOLEAN DEFAULT FALSE,
  meta_report_id TEXT,
  reported_at TIMESTAMPTZ,
  screenshot_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE deepfake_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deepfake_detections_service_all" ON deepfake_detections FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Index: celebrity lookup
CREATE INDEX idx_deepfake_detections_celebrity
  ON deepfake_detections (celebrity_id, created_at DESC);

-- Index: unreported detections for Meta BRP batch reporting
CREATE INDEX idx_deepfake_detections_unreported
  ON deepfake_detections (reported_to_meta, created_at)
  WHERE reported_to_meta = FALSE;

-- Index: celebrity name trigram for text search
CREATE INDEX idx_deepfake_detections_celeb_name_trgm
  ON deepfake_detections USING gin (celebrity_name gin_trgm_ops);

-- -----------------------------------------------------------
-- 3. Auto-increment detection_count on monitored_celebrities
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_celebrity_detection_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.celebrity_id IS NOT NULL THEN
    UPDATE monitored_celebrities
    SET detection_count = detection_count + 1,
        last_detected_at = NOW(),
        updated_at = NOW()
    WHERE id = NEW.celebrity_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deepfake_detection_increment_count
  AFTER INSERT ON deepfake_detections
  FOR EACH ROW EXECUTE FUNCTION increment_celebrity_detection_count();

-- -----------------------------------------------------------
-- 4. Add Hive AI columns to flagged_ads
-- -----------------------------------------------------------
ALTER TABLE flagged_ads
  ADD COLUMN IF NOT EXISTS ai_generated_image BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deepfake_detected BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hive_result JSONB,
  ADD COLUMN IF NOT EXISTS impersonated_celebrity TEXT;
