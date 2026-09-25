-- v324 — stop auto-granting anon/authenticated on NEW public objects (2026-09-25)
--
-- Every public table (177) and function (204) is owned by `postgres`, the role
-- migrations run as. Its default ACL in `public` granted anon + authenticated
-- full table rights (arwdDxtm), sequence rights (rwU) and EXECUTE on every
-- object created afterwards, so a new table was reachable through PostgREST the
-- moment it existed — RLS, and remembering to REVOKE, were the only guards
-- (v321/v322 had to claw back grants the defaults handed out).
--
-- From this migration on, objects created by `postgres` in `public` get NO
-- privileges for anon/authenticated (functions: see below — PUBLIC EXECUTE
-- remains); each migration GRANTs exactly what the app needs (see supabase/CLAUDE.md §7). service_role and postgres keep their
-- defaults. EXISTING objects are untouched — this only changes what future
-- CREATE statements receive.
--
-- Functions: only the anon/authenticated entries are revoked. Postgres ALSO
-- grants EXECUTE to PUBLIC on every new function by a built-in default that
-- cannot be scoped to one schema; revoking it globally would strip EXECUTE
-- from future postgres-created functions in every schema (e.g. extension
-- functions on an upgrade), so it is deliberately NOT revoked here. Result:
--   - new SECURITY INVOKER functions stay executable via PUBLIC — acceptable,
--     they run with the caller's rights and RLS still applies;
--   - new SECURITY DEFINER functions must carry their own
--     `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated`, which the
--     migration lint (apps/web/__tests__/migrationLint.test.ts) requires for
--     every migration from v324 on.
--
-- service_role keeps its own default grants: the postgres/public default ACL
-- carries separate service_role entries (queried 2026-09-25:
--   r: service_role=arwdDxtm/postgres, S: service_role=rwU/postgres,
--   f: service_role=X/postgres) which this migration does not touch.
--
-- Not covered: the `supabase_admin` default ACL in `public` (same grants). No
-- public object is owned by supabase_admin today, and postgres cannot alter
-- another role's defaults; objects created through the dashboard SQL editor
-- run as postgres and ARE covered.
--
-- Idempotent: re-running leaves the same default ACL.
-- Reverse:  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--             GRANT ALL ON TABLES TO anon, authenticated;  (and SEQUENCES,
--           FUNCTIONS) — not recommended.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
