-- Migration v105: wrap auth.uid() / auth.role() / auth.jwt() in (SELECT ...)
-- across all RLS policies that don't already wrap them.
--
-- The Supabase advisor flags this pattern as `auth_rls_initplan` because
-- unwrapped auth.* calls are evaluated PER ROW during policy execution.
-- Wrapping them in (SELECT auth.uid()) makes the planner treat the value
-- as an InitPlan node — evaluated ONCE per query, then reused for every
-- row check. Supabase's troubleshooting docs report >100x perf
-- improvement on million-row tables.
--
-- This migration affects 60 policies across 37 tables (verified via
-- pg_policies). Approach:
--   1. SELECT all flagged policies into a record loop.
--   2. For each, build the new qual / with_check by regex-replacing
--      `auth.uid()` → `(SELECT auth.uid())` (and same for role/jwt).
--   3. DROP the old policy and CREATE a new one with identical name,
--      cmd, permissive flag, role list, and substituted expressions.
--
-- This is purely a planner-perf change: the boolean result of any
-- policy is identical before and after — anyone who could see a row
-- before still can; anyone who couldn't, still can't. Zero behaviour
-- change. Tested by re-running the qualifying-pattern query post-apply
-- and confirming every flagged policy is rewritten.
--
-- The TO clause is preserved verbatim (most policies are `TO public`
-- which is Postgres' default-equivalent-to-all-roles). Some Phase 1.3
-- consolidation work will narrow these to `TO authenticated` later;
-- that's a separate change because it's behaviourally significant
-- (anon would no longer match).
--
-- Idempotent: running this migration a second time finds zero
-- qualifying policies and is a no-op.

DO $$
DECLARE
  p record;
  new_qual text;
  new_with_check text;
  permissive_clause text;
  using_clause text;
  check_clause text;
  role_list text;
  rewritten_count int := 0;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname='public'
      AND (
        (qual ~ 'auth\.(uid|role|jwt)\(\)' AND qual !~ '\(\s*SELECT\s+auth\.(uid|role|jwt)') OR
        (with_check ~ 'auth\.(uid|role|jwt)\(\)' AND with_check !~ '\(\s*SELECT\s+auth\.(uid|role|jwt)')
      )
  LOOP
    -- Substitute unwrapped auth.* calls. (Already-wrapped calls don't
    -- match because the regex-flagged-policy filter only includes
    -- policies that have unwrapped calls.)
    new_qual := p.qual;
    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual, 'auth\.uid\(\)', '(SELECT auth.uid())', 'g');
      new_qual := regexp_replace(new_qual, 'auth\.role\(\)', '(SELECT auth.role())', 'g');
      new_qual := regexp_replace(new_qual, 'auth\.jwt\(\)', '(SELECT auth.jwt())', 'g');
      -- Defensive: collapse any accidentally-double-wrapped occurrences
      -- (shouldn't happen given the filter, but safe).
      new_qual := regexp_replace(new_qual, '\(\s*SELECT\s+\(\s*SELECT\s+auth\.(uid|role|jwt)\(\)\s*\)\s*\)',
                                  '(SELECT auth.\1())', 'g');
    END IF;

    new_with_check := p.with_check;
    IF new_with_check IS NOT NULL THEN
      new_with_check := regexp_replace(new_with_check, 'auth\.uid\(\)', '(SELECT auth.uid())', 'g');
      new_with_check := regexp_replace(new_with_check, 'auth\.role\(\)', '(SELECT auth.role())', 'g');
      new_with_check := regexp_replace(new_with_check, 'auth\.jwt\(\)', '(SELECT auth.jwt())', 'g');
      new_with_check := regexp_replace(new_with_check, '\(\s*SELECT\s+\(\s*SELECT\s+auth\.(uid|role|jwt)\(\)\s*\)\s*\)',
                                        '(SELECT auth.\1())', 'g');
    END IF;

    permissive_clause := CASE WHEN p.permissive='PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END;
    using_clause := CASE WHEN new_qual IS NOT NULL THEN 'USING (' || new_qual || ')' ELSE '' END;
    check_clause := CASE WHEN new_with_check IS NOT NULL THEN 'WITH CHECK (' || new_with_check || ')' ELSE '' END;
    role_list := array_to_string(p.roles, ', ');

    -- DROP + CREATE in the same DO block; transaction wrapper means it's
    -- atomic — if the CREATE fails, the DROP rolls back too.
    EXECUTE format('DROP POLICY %I ON %I.%I',
                   p.policyname, p.schemaname, p.tablename);

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s %s %s',
      p.policyname, p.schemaname, p.tablename,
      permissive_clause, p.cmd, role_list,
      using_clause, check_clause
    );

    rewritten_count := rewritten_count + 1;
  END LOOP;

  RAISE NOTICE 'v105: rewrote % RLS policies to use (SELECT auth.*) initplan pattern',
               rewritten_count;
END $$;

-- ─── Verification (run manually after apply) ────────────────────────────────
-- SELECT count(*) FROM pg_policies
-- WHERE schemaname='public'
--   AND (
--     (qual ~ 'auth\.(uid|role|jwt)\(\)' AND qual !~ '\(\s*SELECT\s+auth\.(uid|role|jwt)') OR
--     (with_check ~ 'auth\.(uid|role|jwt)\(\)' AND with_check !~ '\(\s*SELECT\s+auth\.(uid|role|jwt)')
--   );
--   → should return 0
--
-- mcp__supabase__get_advisors performance:
--   auth_rls_initplan: 60 → 0
