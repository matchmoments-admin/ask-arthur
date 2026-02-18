-- migration-v6: Harden check_stats region column against NULL values
-- Run in Supabase SQL Editor

-- 1. Backfill any existing NULL regions
UPDATE check_stats SET region = '__unknown__' WHERE region IS NULL;

-- 2. Add NOT NULL constraint with default
ALTER TABLE check_stats
  ALTER COLUMN region SET DEFAULT '__unknown__',
  ALTER COLUMN region SET NOT NULL;

-- 3. Replace the increment function to COALESCE NULL region
CREATE OR REPLACE FUNCTION increment_check_stats(
  p_verdict TEXT,
  p_region TEXT DEFAULT '__unknown__'
)
RETURNS VOID AS $$
DECLARE
  safe_region TEXT := COALESCE(NULLIF(TRIM(p_region), ''), '__unknown__');
BEGIN
  INSERT INTO check_stats (date, region, total_checks, safe_count, suspicious_count, high_risk_count)
  VALUES (
    CURRENT_DATE,
    safe_region,
    1,
    CASE WHEN p_verdict = 'SAFE' THEN 1 ELSE 0 END,
    CASE WHEN p_verdict = 'SUSPICIOUS' THEN 1 ELSE 0 END,
    CASE WHEN p_verdict = 'HIGH_RISK' THEN 1 ELSE 0 END
  )
  ON CONFLICT (date, region) DO UPDATE SET
    total_checks = check_stats.total_checks + 1,
    safe_count = check_stats.safe_count + CASE WHEN p_verdict = 'SAFE' THEN 1 ELSE 0 END,
    suspicious_count = check_stats.suspicious_count + CASE WHEN p_verdict = 'SUSPICIOUS' THEN 1 ELSE 0 END,
    high_risk_count = check_stats.high_risk_count + CASE WHEN p_verdict = 'HIGH_RISK' THEN 1 ELSE 0 END;
END;
$$ LANGUAGE plpgsql;
