-- v132 — Breaches table RLS multi-permissive consolidation.
--
-- WHY: Performance advisor surfaces 5 `multiple_permissive_policies` WARNs,
-- all on `public.breaches`. The overlap comes from two PERMISSIVE policies
-- both attached to the broad `public` PostgreSQL role:
--
--   1. "Admins manage breaches"           — cmd ALL, qual: is admin
--   2. "Public read published breaches"   — cmd SELECT, qual: published AND NOT redacted
--
-- For every SELECT, Postgres evaluates BOTH policies and OR-combines the
-- predicates. The same overlap fans out across the 5 sub-roles inheriting
-- from `public` (anon, authenticated, authenticator, dashboard_user,
-- supabase_privileged_role) — hence 5 advisor lints from 1 table.
--
-- The fix is to split admin-write authority from the SELECT predicate so
-- only ONE permissive policy evaluates per cmd.
--
-- BEHAVIOUR PRESERVATION:
--   * Admins still see/insert/update/delete all rows (admin OR public predicate on SELECT).
--   * Anonymous + authenticated users still only see published+non-redacted rows.
--   * No existing code reads `breaches` (Breach Defence Suite is paused with
--     all consumer flags OFF; verified via codebase grep on 2026-05-17).
--
-- IDEMPOTENT: DROP POLICY IF EXISTS … CREATE POLICY. Safe to re-run.
--
-- ROLLBACK: see end of file.

-- 1. Drop the two overlapping policies.
DROP POLICY IF EXISTS "Admins manage breaches" ON public.breaches;
DROP POLICY IF EXISTS "Public read published breaches" ON public.breaches;

-- Belt-and-braces — clean up any prior names from earlier attempts.
DROP POLICY IF EXISTS breaches_select ON public.breaches;
DROP POLICY IF EXISTS breaches_admin_insert ON public.breaches;
DROP POLICY IF EXISTS breaches_admin_update ON public.breaches;
DROP POLICY IF EXISTS breaches_admin_delete ON public.breaches;

-- 2. Single SELECT policy combining both predicates.
CREATE POLICY breaches_select
  ON public.breaches
  FOR SELECT
  TO public
  USING (
    (is_published = true AND is_redacted = false)
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (SELECT auth.uid())
        AND up.role = 'admin'
    )
  );

-- 3. Admin-only write policies (one per cmd so SELECT stays single-permissive).
CREATE POLICY breaches_admin_insert
  ON public.breaches
  FOR INSERT
  TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (SELECT auth.uid())
        AND up.role = 'admin'
    )
  );

CREATE POLICY breaches_admin_update
  ON public.breaches
  FOR UPDATE
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (SELECT auth.uid())
        AND up.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (SELECT auth.uid())
        AND up.role = 'admin'
    )
  );

CREATE POLICY breaches_admin_delete
  ON public.breaches
  FOR DELETE
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (SELECT auth.uid())
        AND up.role = 'admin'
    )
  );

COMMENT ON POLICY breaches_select ON public.breaches IS
  'Consolidated SELECT — admins OR (published AND NOT redacted). Replaces the '
  'overlapping "Admins manage breaches" (cmd=ALL) + "Public read published '
  'breaches" (cmd=SELECT) pair that produced 5 multiple_permissive_policies '
  'WARNs. See migration v132 header for rationale.';

-- ROLLBACK (run manually if needed):
--   DROP POLICY breaches_select        ON public.breaches;
--   DROP POLICY breaches_admin_insert  ON public.breaches;
--   DROP POLICY breaches_admin_update  ON public.breaches;
--   DROP POLICY breaches_admin_delete  ON public.breaches;
--   CREATE POLICY "Admins manage breaches" ON public.breaches FOR ALL TO public
--     USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));
--   CREATE POLICY "Public read published breaches" ON public.breaches FOR SELECT TO public
--     USING (is_published = true AND is_redacted = false);
