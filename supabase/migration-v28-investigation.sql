-- Migration v28: Add investigation columns for deep investigation pipeline.
-- The deep investigation pipeline (GitHub Actions) populates these columns
-- with results from tools like nmap, dnsrecon, nikto, whatweb, sslscan.

ALTER TABLE scam_entities
  ADD COLUMN IF NOT EXISTS investigation_data JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS investigated_at TIMESTAMPTZ;

-- Index for querying entities by risk level + investigation status.
-- Note: cannot use NOW() in a partial index predicate (must be IMMUTABLE),
-- so we index on investigated_at directly and filter in queries.
CREATE INDEX IF NOT EXISTS idx_scam_entities_investigation
  ON scam_entities (risk_level, investigated_at)
  WHERE investigation_data IS NULL;
