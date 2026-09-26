-- v332 — six RPC timeouts that were decorative become real (#1162)
--
-- WHY. Each function below caps its runtime with an in-body
-- `SET LOCAL statement_timeout = '300s'`. Called through PostgREST — which is
-- how every supabase-js `.rpc()` reaches them — that line is DECORATIVE:
-- PostgREST logs in as `authenticator` (statement_timeout 8 s), the timer is
-- armed when the top-level statement starts, and a SET LOCAL inside the
-- running function changes current_setting() but never re-arms it (measured
-- 2026-09-17, #1161 / v310). So every caller has been capped at 8 s whatever
-- the body says. No 57014 has been recorded in 45 days (the tables are small
-- today), which is exactly why the gap is dangerous: it fails only on the day
-- a backlog makes the job big.
--
-- WHAT. The function-level clause IS honoured (v310's proof), and
-- `ALTER FUNCTION … SET` sets it without touching a body. Values are sized to
-- the CALLER's own HTTP ceiling, not the body's 300 s — a statement that
-- outlives its request is killed by Vercel mid-transaction instead:
--   * Inngest steps (/api/inngest maxDuration 300 s) → 240 s:
--       anonymise_expired_footprints, sweep_inactive_monitors,
--       prune_cost_telemetry, prune_telco_events
--   * shop-checks-retention route (maxDuration 60 s, loops the RPC) → 45 s:
--       cleanup_expired_shop_checks
--   * the NRD ingest write (one step that also downloads and matches) → 60 s:
--       upsert_clone_alerts_batch
-- `_prune_chunked` is NOT given a clause: it is only ever called from inside
-- prune_telco_events, and a function-level SET re-arms the timer on entry, so
-- a nested clause would EXTEND its caller's cap. prune_telco_events (the
-- entry point, which had no cap at all) carries it instead.
--
-- The in-body SET LOCAL lines stay (bodies unchanged); they are harmless.
-- Idempotent: ALTER … SET replaces the value. ACLs are unaffected.
-- Rollback: ALTER FUNCTION … RESET statement_timeout for each.

BEGIN;

ALTER FUNCTION public.anonymise_expired_footprints() SET statement_timeout = '240s';
ALTER FUNCTION public.sweep_inactive_monitors() SET statement_timeout = '240s';
ALTER FUNCTION public.prune_cost_telemetry(integer) SET statement_timeout = '240s';
ALTER FUNCTION public.prune_telco_events() SET statement_timeout = '240s';
ALTER FUNCTION public.cleanup_expired_shop_checks(integer) SET statement_timeout = '45s';
ALTER FUNCTION public.upsert_clone_alerts_batch(jsonb) SET statement_timeout = '60s';

COMMIT;
