-- v268: scam_reports accepts UNCERTAIN; check_stats counts it — Tier 3
-- item 13a (wayfinder #903; founder decision 2026-08-08).
--
-- WHY NOW. FF_ANALYZE_INNGEST_WEB is ON in prod and the durable
-- analyze-report consumer persists EVERY analysis verdict verbatim into
-- create_scam_report — where scam_reports_verdict_check still allowed only
-- the three launch-era values. Every UNCERTAIN analysis therefore failed its
-- persist and the report row was silently lost (0 UNCERTAIN rows in prod is
-- the constraint working, not the verdict never occurring).
--
-- SCOPE — narrow widening, deliberately. CONTEXT.md's documented deferral
-- ("widening is a cross-table migration touching every read/write site") is
-- about making READERS use UNCERTAIN semantically. This migration only stops
-- the row loss: every inspected reader (onward sweeps, escalation gates,
-- brand alerts) filters on HIGH_RISK/SUSPICIOUS explicitly, so an UNCERTAIN
-- row flows through as present-but-not-actionable — which is what it means.
--
-- check_stats: UNCERTAIN previously fell through all three CASE arms — the
-- check counted into total_checks but no verdict bucket, making the buckets
-- silently not sum to the total. New uncertain_count column closes that.
--
-- Idempotent throughout.

ALTER TABLE public.check_stats
  ADD COLUMN IF NOT EXISTS uncertain_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.scam_reports
  DROP CONSTRAINT IF EXISTS scam_reports_verdict_check;

ALTER TABLE public.scam_reports
  ADD CONSTRAINT scam_reports_verdict_check
  CHECK (verdict = ANY (ARRAY['SAFE'::text, 'UNCERTAIN'::text, 'SUSPICIOUS'::text, 'HIGH_RISK'::text]));

CREATE OR REPLACE FUNCTION public.increment_check_stats(p_verdict text, p_region text DEFAULT '__unknown__'::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  safe_region TEXT := COALESCE(NULLIF(TRIM(p_region), ''), '__unknown__');
BEGIN
  INSERT INTO check_stats (date, region, total_checks, safe_count, uncertain_count, suspicious_count, high_risk_count)
  VALUES (
    CURRENT_DATE,
    safe_region,
    1,
    CASE WHEN p_verdict = 'SAFE' THEN 1 ELSE 0 END,
    CASE WHEN p_verdict = 'UNCERTAIN' THEN 1 ELSE 0 END,
    CASE WHEN p_verdict = 'SUSPICIOUS' THEN 1 ELSE 0 END,
    CASE WHEN p_verdict = 'HIGH_RISK' THEN 1 ELSE 0 END
  )
  ON CONFLICT (date, region) DO UPDATE SET
    total_checks = check_stats.total_checks + 1,
    safe_count = check_stats.safe_count + CASE WHEN p_verdict = 'SAFE' THEN 1 ELSE 0 END,
    uncertain_count = check_stats.uncertain_count + CASE WHEN p_verdict = 'UNCERTAIN' THEN 1 ELSE 0 END,
    suspicious_count = check_stats.suspicious_count + CASE WHEN p_verdict = 'SUSPICIOUS' THEN 1 ELSE 0 END,
    high_risk_count = check_stats.high_risk_count + CASE WHEN p_verdict = 'HIGH_RISK' THEN 1 ELSE 0 END;
END;
$function$;
