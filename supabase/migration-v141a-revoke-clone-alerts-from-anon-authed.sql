-- v141a — clear Supabase advisor WARNs 0028 + 0029 on
-- public.upsert_clone_alerts_batch (anon + authenticated executable
-- via /rest/v1/rpc/).
--
-- v141 used `REVOKE EXECUTE FROM PUBLIC + GRANT TO service_role`, but
-- the advisor still flags the function as reachable from anon /
-- authenticated via PostgREST. Explicit per-role REVOKE is the
-- belt-and-braces fix.
--
-- Caught by `mcp__supabase__get_advisors` after v141 applied to prod;
-- this migration was applied via `mcp__supabase__apply_migration` and
-- the advisor re-check returned clean (only pre-existing
-- `infra_cost_daily` INFO remains).

REVOKE EXECUTE ON FUNCTION public.upsert_clone_alerts_batch(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_clone_alerts_batch(JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_clone_alerts_batch(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_clone_alerts_batch(JSONB) TO service_role;
