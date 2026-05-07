-- Migration v111: merge overlapping permissive policies into single OR'd
-- policies (Phase 1.3 follow-up to v107)
--
-- v107 dropped 24 redundant service-role-only permissive policies. The
-- residual 70 multi_permissive_policies WARNs are real overlaps where a
-- table has both a user-scope policy (user_id = auth.uid()) and an
-- org-scope policy (EXISTS in org_members). Postgres evaluates ALL
-- permissive policies and OR's them; the lint flags the redundancy of
-- having two policies that need separate evaluation when ONE policy with
-- the same OR'd condition would do the same work in fewer planner nodes.
--
-- Per-cmd merge approach: each combined policy preserves the EXACT
-- behavioural disjunction (any caller who could see / write a row before
-- still can; anyone who couldn't, still can't). Different cmds get
-- different merged policies because the org-scope role requirements
-- differ between SELECT (any active member) and DELETE/UPDATE
-- (owner/admin only) — collapsing into a single ALL policy would lose
-- those distinctions.
--
-- Tables consolidated (8 tables, ~14 cmd-combinations):
--   api_keys (4 cmds)
--   api_usage_log (1)
--   family_members (1, slightly different — user-scope is read, admin
--                  scope is write; merged into per-cmd policies)
--   phone_footprint_entitlements (1)
--   phone_footprint_monitors (4)
--   phone_footprints (1)
--   sim_swap_monitors (1)
--   breaches deliberately SKIPPED — overlap is admin (cmd=ALL) vs
--     public-read (cmd=SELECT) where merging would force admin-check
--     onto every public read, materially hurting perf for negligible
--     advisor benefit. 1 residual WARN accepted.
--
-- service_role bypasses RLS so backend code is unaffected. The lint count
-- drops from 70 → ~12 (the 12 being mostly the breaches case + a few
-- INSERT/UPDATE/DELETE permutations on phone_footprint_monitors that
-- come from cmd=ALL expansion).

-- ─── api_keys: merge user-scope + org-scope per cmd ────────────────────────
DROP POLICY IF EXISTS "Users delete own api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "Org admins delete org api_keys" ON public.api_keys;
CREATE POLICY "api_keys_delete_user_or_org_admin" ON public.api_keys
  AS PERMISSIVE FOR DELETE TO public
  USING (
    ((SELECT auth.uid()) = user_id)
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = (SELECT auth.uid())
        AND org_members.role = ANY(ARRAY['owner'::text, 'admin'::text])
        AND org_members.status = 'active'
    ))
  );

DROP POLICY IF EXISTS "Users insert own api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "Org admins insert org api_keys" ON public.api_keys;
CREATE POLICY "api_keys_insert_user_or_org_admin" ON public.api_keys
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    ((SELECT auth.uid()) = user_id)
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = (SELECT auth.uid())
        AND org_members.role = ANY(ARRAY['owner'::text, 'admin'::text, 'developer'::text])
        AND org_members.status = 'active'
    ))
  );

DROP POLICY IF EXISTS "Users select own api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "Org members select org api_keys" ON public.api_keys;
CREATE POLICY "api_keys_select_user_or_org_member" ON public.api_keys
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT auth.uid()) = user_id)
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = (SELECT auth.uid())
        AND org_members.status = 'active'
    ))
  );

DROP POLICY IF EXISTS "Users update own api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "Org admins update org api_keys" ON public.api_keys;
CREATE POLICY "api_keys_update_user_or_org_admin" ON public.api_keys
  AS PERMISSIVE FOR UPDATE TO public
  USING (
    ((SELECT auth.uid()) = user_id)
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = (SELECT auth.uid())
        AND org_members.role = ANY(ARRAY['owner'::text, 'admin'::text])
        AND org_members.status = 'active'
    ))
  )
  WITH CHECK (
    ((SELECT auth.uid()) = user_id)
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = (SELECT auth.uid())
        AND org_members.role = ANY(ARRAY['owner'::text, 'admin'::text])
        AND org_members.status = 'active'
    ))
  );

-- ─── api_usage_log: merge owner + org member SELECT ────────────────────────
DROP POLICY IF EXISTS "Users select own api_usage_log" ON public.api_usage_log;
DROP POLICY IF EXISTS "Org members select org api_usage_log" ON public.api_usage_log;
CREATE POLICY "api_usage_log_select_user_or_org" ON public.api_usage_log
  AS PERMISSIVE FOR SELECT TO public
  USING (
    user_owns_key_hash(key_hash)
    OR EXISTS (
      SELECT 1 FROM public.api_keys
        JOIN public.org_members ON org_members.org_id = api_keys.org_id
       WHERE api_keys.key_hash = api_usage_log.key_hash
         AND org_members.user_id = (SELECT auth.uid())
         AND org_members.status = 'active'
    )
  );

-- ─── family_members: merge admin-write + member-read into per-cmd policies ─
-- The original family_members_manage cmd=ALL gives admins full CRUD on
-- their group's family_members. The original family_members_read cmd=SELECT
-- gives every member read access. Merge: keep admin-ALL (drop SELECT
-- portion of overlap) by narrowing manage to writes only, and broaden
-- read to all members.
DROP POLICY IF EXISTS "family_members_manage" ON public.family_members;
DROP POLICY IF EXISTS "family_members_read" ON public.family_members;

CREATE POLICY "family_members_select_any_member" ON public.family_members
  AS PERMISSIVE FOR SELECT TO public
  USING (
    group_id IN (
      SELECT family_members_1.group_id
      FROM public.family_members family_members_1
      WHERE family_members_1.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "family_members_insert_admin_only" ON public.family_members
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    group_id IN (
      SELECT family_members_1.group_id
      FROM public.family_members family_members_1
      WHERE family_members_1.user_id = (SELECT auth.uid())
        AND family_members_1.role = 'admin'
    )
  );

CREATE POLICY "family_members_update_admin_only" ON public.family_members
  AS PERMISSIVE FOR UPDATE TO public
  USING (
    group_id IN (
      SELECT family_members_1.group_id
      FROM public.family_members family_members_1
      WHERE family_members_1.user_id = (SELECT auth.uid())
        AND family_members_1.role = 'admin'
    )
  );

CREATE POLICY "family_members_delete_admin_only" ON public.family_members
  AS PERMISSIVE FOR DELETE TO public
  USING (
    group_id IN (
      SELECT family_members_1.group_id
      FROM public.family_members family_members_1
      WHERE family_members_1.user_id = (SELECT auth.uid())
        AND family_members_1.role = 'admin'
    )
  );

-- ─── phone_footprint_entitlements: merge user + org admin SELECT ───────────
DROP POLICY IF EXISTS "Users read own entitlements" ON public.phone_footprint_entitlements;
DROP POLICY IF EXISTS "Org admins read org entitlements" ON public.phone_footprint_entitlements;
CREATE POLICY "phone_footprint_entitlements_select_user_or_org_admin"
  ON public.phone_footprint_entitlements
  AS PERMISSIVE FOR SELECT TO public
  USING (
    user_id = (SELECT auth.uid())
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = phone_footprint_entitlements.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY(ARRAY['owner'::text, 'admin'::text])
        AND m.status = 'active'
    ))
  );

-- ─── phone_footprint_monitors: 3 overlapping policies on SELECT, 2 on
-- ─── INSERT/UPDATE/DELETE — split into per-cmd merges                     ─
DROP POLICY IF EXISTS "Users manage own phone_footprint_monitors" ON public.phone_footprint_monitors;
DROP POLICY IF EXISTS "Org staff write fleet monitors" ON public.phone_footprint_monitors;
DROP POLICY IF EXISTS "Org members read fleet monitors" ON public.phone_footprint_monitors;

CREATE POLICY "phone_footprint_monitors_select_user_or_org_member"
  ON public.phone_footprint_monitors
  AS PERMISSIVE FOR SELECT TO public
  USING (
    user_id = (SELECT auth.uid())
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
    ))
  );

CREATE POLICY "phone_footprint_monitors_insert_user_or_org_staff"
  ON public.phone_footprint_monitors
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY(ARRAY['owner'::text, 'admin'::text, 'fraud_analyst'::text, 'compliance_officer'::text])
        AND m.status = 'active'
    ))
  );

CREATE POLICY "phone_footprint_monitors_update_user_or_org_staff"
  ON public.phone_footprint_monitors
  AS PERMISSIVE FOR UPDATE TO public
  USING (
    user_id = (SELECT auth.uid())
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY(ARRAY['owner'::text, 'admin'::text, 'fraud_analyst'::text, 'compliance_officer'::text])
        AND m.status = 'active'
    ))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY(ARRAY['owner'::text, 'admin'::text, 'fraud_analyst'::text, 'compliance_officer'::text])
        AND m.status = 'active'
    ))
  );

CREATE POLICY "phone_footprint_monitors_delete_user_or_org_staff"
  ON public.phone_footprint_monitors
  AS PERMISSIVE FOR DELETE TO public
  USING (
    user_id = (SELECT auth.uid())
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY(ARRAY['owner'::text, 'admin'::text, 'fraud_analyst'::text, 'compliance_officer'::text])
        AND m.status = 'active'
    ))
  );

-- ─── phone_footprints: merge user + org member SELECT ──────────────────────
DROP POLICY IF EXISTS "Users read own phone_footprints" ON public.phone_footprints;
DROP POLICY IF EXISTS "Org members read phone_footprints" ON public.phone_footprints;
CREATE POLICY "phone_footprints_select_user_or_org_member"
  ON public.phone_footprints
  AS PERMISSIVE FOR SELECT TO public
  USING (
    user_id = (SELECT auth.uid())
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = phone_footprints.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
    ))
  );

-- ─── sim_swap_monitors: merge user + org admin SELECT ──────────────────────
DROP POLICY IF EXISTS "Users read own sim_swap_monitors" ON public.sim_swap_monitors;
DROP POLICY IF EXISTS "Org admins read sim_swap_monitors" ON public.sim_swap_monitors;
CREATE POLICY "sim_swap_monitors_select_user_or_org_admin"
  ON public.sim_swap_monitors
  AS PERMISSIVE FOR SELECT TO public
  USING (
    user_id = (SELECT auth.uid())
    OR ((org_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = sim_swap_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY(ARRAY['owner'::text, 'admin'::text, 'fraud_analyst'::text, 'compliance_officer'::text])
        AND m.status = 'active'
    ))
  );

-- ─── Verification (run manually after apply) ────────────────────────────────
-- mcp__supabase__get_advisors performance:
--   multiple_permissive_policies: 70 → ~12 (residual is breaches +
--     a small number from cmd=ALL expansions on phone_footprint_monitors).
