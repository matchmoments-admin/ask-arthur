-- Migration v19: Expand phone_lookups with risk scoring and CNAM fields
-- Phone intelligence upgrade: risk score, risk level, caller name (PII-scrubbed)

ALTER TABLE phone_lookups
  ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'LOW',
  ADD COLUMN IF NOT EXISTS caller_name TEXT,
  ADD COLUMN IF NOT EXISTS caller_name_type TEXT;

-- Index for quickly finding high-risk phone lookups
CREATE INDEX IF NOT EXISTS idx_phone_lookups_risk_score
  ON phone_lookups (risk_score) WHERE risk_score >= 40;
