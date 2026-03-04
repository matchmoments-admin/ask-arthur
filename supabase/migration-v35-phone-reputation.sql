-- Migration v35: Phone reputation for call screening
-- Phase E1: Offline cache for Android call screening

CREATE TABLE IF NOT EXISTS phone_reputation (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone_hash TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL DEFAULT 'AU',
  threat_level TEXT NOT NULL CHECK (threat_level IN ('HIGH', 'MEDIUM', 'LOW', 'NONE')),
  scam_type TEXT,
  report_count INT NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'community',
  active BOOLEAN NOT NULL DEFAULT true
);

-- Index for lookup by hash (primary query path for call screening)
CREATE INDEX IF NOT EXISTS idx_phone_rep_hash
  ON phone_reputation (phone_hash)
  WHERE active = true;

-- Index for threat snapshot export (ordered by threat level)
CREATE INDEX IF NOT EXISTS idx_phone_rep_threat
  ON phone_reputation (threat_level, last_seen DESC)
  WHERE active = true;

-- RPC to report a phone number
CREATE OR REPLACE FUNCTION report_phone_number(
  p_phone_hash TEXT,
  p_country_code TEXT DEFAULT 'AU',
  p_threat_level TEXT DEFAULT 'MEDIUM',
  p_scam_type TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'community'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO phone_reputation (phone_hash, country_code, threat_level, scam_type, source)
  VALUES (p_phone_hash, p_country_code, p_threat_level, p_scam_type, p_source)
  ON CONFLICT (phone_hash) DO UPDATE SET
    threat_level = CASE
      WHEN EXCLUDED.threat_level = 'HIGH' THEN 'HIGH'
      WHEN phone_reputation.threat_level = 'HIGH' THEN 'HIGH'
      ELSE EXCLUDED.threat_level
    END,
    scam_type = COALESCE(EXCLUDED.scam_type, phone_reputation.scam_type),
    report_count = phone_reputation.report_count + 1,
    last_seen = now(),
    active = true;
END;
$$;
