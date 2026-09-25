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
-- privileges for anon/authenticated; each migration GRANTs exactly what the
-- app needs (see supabase/CLAUDE.md §7). service_role and postgres keep their
-- defaults. EXISTING objects are untouched — this only changes what future
-- CREATE statements receive.
--
-- Functions: Postgres also grants EXECUTE to PUBLIC on every new function by a
-- built-in default that a schema-scoped entry cannot remove, so the global form
-- (no IN SCHEMA) revokes that for functions `postgres` creates.
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

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
