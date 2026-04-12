-- migration-v47: User verdict feedback for false positive/negative tracking

CREATE TABLE IF NOT EXISTS verdict_feedback (
  id SERIAL PRIMARY KEY,
  reporter_hash TEXT NOT NULL,
  verdict_given TEXT NOT NULL CHECK (verdict_given IN ('SAFE', 'UNCERTAIN', 'SUSPICIOUS', 'HIGH_RISK')),
  user_says TEXT NOT NULL CHECK (user_says IN ('correct', 'false_positive', 'false_negative')),
  comment TEXT,
  submitted_content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verdict_feedback_created ON verdict_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verdict_feedback_type ON verdict_feedback (user_says);
