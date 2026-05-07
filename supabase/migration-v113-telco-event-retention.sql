-- Migration v113: telco event-table retention (Phase 2.3)
--
-- 7 append-only telco event tables had zero retention before this PR.
-- Designed for high-volume Vonage / Twilio events; once those providers
-- flip out of mock mode, every Phone Footprint refresh writes 4-6 rows
-- per call. At 1k DAU paid, that's ~10k rows/day across these tables.
--
-- Retention windows reflect forensic and operational requirements:
--   - sim_swap_events / device_swap_events: 730 days (2 years).
--     Forensic value for fraud-investigation lookbacks; sim-swap is the
--     central evidence in account-takeover claims.
--   - subscriber_match_checks: 365 days. CAMARA verification trail.
--   - telco_signal_history: 365 days. Provider health time-series; older
--     than a year has no operational value.
--   - telco_api_usage: 365 days. Cost reconciliation against Vonage
--     billing reports (which Vonage retains 13 months).
--   - phone_lookups: 365 days. Twilio Lookup forensic trail.
--   - phone_footprint_otp_attempts: 365 days. Anti-abuse rate-limit
--     forensics.
--
-- All tables use a created_at-style timestamp column (verified via
-- information_schema.columns); telco_signal_history uses observed_at;
-- phone_footprint_otp_attempts uses attempted_at. No FK cascades trip
-- on these deletes (verified — no child tables reference them).
--
-- Single combined RPC keeps observability simple: one nightly Inngest
-- run reports per-table deletion counts. Total runtime is sub-second
-- on current data volumes (most tables are 0 rows pending Vonage live).

CREATE OR REPLACE FUNCTION public.prune_telco_events()
RETURNS TABLE (
  table_name text,
  rows_deleted int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deleted int;
BEGIN
  -- 730-day forensic windows
  DELETE FROM public.sim_swap_events
   WHERE created_at < NOW() - INTERVAL '730 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'sim_swap_events'::text, v_deleted;

  DELETE FROM public.device_swap_events
   WHERE created_at < NOW() - INTERVAL '730 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'device_swap_events'::text, v_deleted;

  -- 365-day standard windows
  DELETE FROM public.subscriber_match_checks
   WHERE created_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'subscriber_match_checks'::text, v_deleted;

  DELETE FROM public.telco_signal_history
   WHERE observed_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'telco_signal_history'::text, v_deleted;

  DELETE FROM public.telco_api_usage
   WHERE created_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'telco_api_usage'::text, v_deleted;

  DELETE FROM public.phone_lookups
   WHERE created_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'phone_lookups'::text, v_deleted;

  DELETE FROM public.phone_footprint_otp_attempts
   WHERE attempted_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'phone_footprint_otp_attempts'::text, v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_telco_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_telco_events() TO service_role;

COMMENT ON FUNCTION public.prune_telco_events() IS
  'Deletes telco event-table rows older than the per-table retention '
  'window. 730d for sim/device-swap-events (forensic); 365d for the '
  'rest. Returns one row per table with deletion count. Called nightly '
  'from the telco-events-retention Inngest function.';
