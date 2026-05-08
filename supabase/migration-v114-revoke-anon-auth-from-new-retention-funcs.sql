-- Migration v114: revoke anon + authenticated EXECUTE on new retention RPCs
--
-- v112 (cost_telemetry retention) and v113 (telco event retention) created
-- 3 new SECURITY DEFINER functions:
--   - prune_cost_telemetry(integer)
--   - refresh_cost_telemetry_daily_rollup(integer)
--   - prune_telco_events()
--
-- Both migrations included `REVOKE ALL ON FUNCTION ... FROM PUBLIC` but
-- supabase's default-privilege configuration ALSO grants EXECUTE
-- explicitly to anon + authenticated when a function is created. The
-- PUBLIC revoke doesn't cancel the explicit grants — they need their
-- own REVOKE.
--
-- This was a gap in the v104 / v110 lockdown pattern that didn't apply
-- to those (older) functions because they were created before
-- supabase's default-grant-on-CREATE behaviour kicked in. New functions
-- need REVOKE FROM anon, authenticated, PUBLIC explicitly.
--
-- Closes 6 advisor WARNs (3 functions × 2 roles). After this PR, only
-- the manual HIBP toggle remains.

REVOKE EXECUTE ON FUNCTION public.prune_cost_telemetry(integer)
  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_cost_telemetry_daily_rollup(integer)
  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_telco_events()
  FROM anon, authenticated, PUBLIC;

-- service_role grants explicitly preserved (defensive — was already in v112/v113).
GRANT EXECUTE ON FUNCTION public.prune_cost_telemetry(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_cost_telemetry_daily_rollup(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_telco_events() TO service_role;
