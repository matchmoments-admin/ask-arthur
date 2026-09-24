-- v321 — tighten write privileges on account tables (2026-09-24)
--
-- api_keys, user_profiles and org_members carried Supabase's default table-level
-- grants (INSERT/UPDATE/DELETE/TRUNCATE…) to `anon` and `authenticated`, with RLS
-- as the only guard. Their server-owned columns (key tier and limits, billing and
-- phone-verification fields, membership role) should only ever be written by the
-- service role or by the SECURITY DEFINER functions that own those transitions
-- (generate_api_key_record, generate_org_api_key, sync_subscription_tier,
-- create_organization, handle_new_user, set_user_admin).
--
-- Column-level REVOKE is inert while a table-level grant exists, so this revokes
-- at table level and re-grants only the columns the app writes with a
-- user-scoped client:
--   api_keys.is_active          — apps/web/app/api/keys/[id]/route.ts (revoke key)
--   user_profiles.display_name,
--   user_profiles.company_name  — user-editable profile fields
-- Every other writer uses the service role, which these grants do not affect.
-- DELETE for `authenticated` is left to RLS (unchanged here).
--
-- Idempotent: REVOKE/GRANT are no-ops when already in the target state.
-- Reverse: GRANT INSERT, UPDATE ON <table> TO authenticated (not recommended).

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.api_keys, public.user_profiles, public.org_members
  FROM anon;

REVOKE INSERT, UPDATE, TRUNCATE
  ON public.api_keys, public.user_profiles, public.org_members
  FROM authenticated;

GRANT UPDATE (is_active) ON public.api_keys TO authenticated;
GRANT UPDATE (display_name, company_name) ON public.user_profiles TO authenticated;
