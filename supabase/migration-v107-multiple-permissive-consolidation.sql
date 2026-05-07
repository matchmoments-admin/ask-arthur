-- Migration v107: drop 24 redundant service-role-only PERMISSIVE policies
-- (Phase 1.3 — multiple-permissive-policy consolidation)
--
-- The Supabase advisor flags 210 multiple_permissive_policies WARNs because
-- many tables have BOTH a "Service role can ..." permissive policy AND a
-- user/org/admin scope permissive policy on the same (role, cmd) pair.
-- Postgres OR's permissive policies, so all of them are evaluated for
-- every request — even though service_role bypasses RLS entirely and
-- the service-role-only policy adds zero behavioural value.
--
-- Why the service-role-only PERMISSIVE policies are functionally dead:
--   1. service_role bypasses RLS; the policy is never consulted FOR
--      service_role callers.
--   2. The policy's qual is `auth.role() = 'service_role'`, so for ANY
--      OTHER role (anon, authenticated, postgres-default), the predicate
--      is FALSE — the policy contributes nothing to allowance.
--   3. Therefore: dropping it changes zero behaviour, but eliminates a
--      per-row policy evaluation on every query.
--
-- This migration drops the 24 service-role-only permissive policies that
-- live on tables with at least one non-service-role companion policy.
-- Tables where service-role-only is the SOLE permissive policy (e.g.
-- bot_message_queue, breach_victims_index, cluster_reports_archive,
-- deepfake_detections, flagged_ads, leads, media_analyses, etc.) are NOT
-- in this list — dropping them would leave the table with no permissive
-- policy at all, which is functionally identical (RLS-enabled-no-policy)
-- but generates a DIFFERENT advisor (rls_enabled_no_policy WARN). We
-- already addressed that pattern explicitly in v101 with RESTRICTIVE
-- deny-all policies, so the SOLE-service-role tables stay as-is.
--
-- Tables/policies dropped (24):
DROP POLICY IF EXISTS "Service role manages API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Service role access api_usage_log" ON public.api_usage_log;
DROP POLICY IF EXISTS "Service role manages blog categories" ON public.blog_categories;
DROP POLICY IF EXISTS "Service role manages blog posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Service role only on bsr" ON public.breach_sources_raw;
DROP POLICY IF EXISTS "Service role manage breaches" ON public.breaches;
DROP POLICY IF EXISTS "Service role write cluster_members" ON public.cluster_members;
DROP POLICY IF EXISTS "feed_items_service_all" ON public.feed_items;
DROP POLICY IF EXISTS "Service role access org_invitations" ON public.org_invitations;
DROP POLICY IF EXISTS "Service role access org_members" ON public.org_members;
DROP POLICY IF EXISTS "Service role access organizations" ON public.organizations;
DROP POLICY IF EXISTS "Service role access phone_footprint_alerts" ON public.phone_footprint_alerts;
DROP POLICY IF EXISTS "Service role access phone_footprint_entitlements" ON public.phone_footprint_entitlements;
DROP POLICY IF EXISTS "Service role access phone_footprint_monitors" ON public.phone_footprint_monitors;
DROP POLICY IF EXISTS "Service role access phone_footprints" ON public.phone_footprints;
DROP POLICY IF EXISTS "Service role write report_entity_links" ON public.report_entity_links;
DROP POLICY IF EXISTS "Service role write scam_clusters" ON public.scam_clusters;
DROP POLICY IF EXISTS "Service role write scam_entities" ON public.scam_entities;
DROP POLICY IF EXISTS "Service role write scam_reports" ON public.scam_reports;
DROP POLICY IF EXISTS "Service role access sim_swap_monitors" ON public.sim_swap_monitors;
DROP POLICY IF EXISTS "Service role write site_audits" ON public.site_audits;
DROP POLICY IF EXISTS "Service role write sites" ON public.sites;
DROP POLICY IF EXISTS "Service role access subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Service role access user_profiles" ON public.user_profiles;

-- After this migration, every dropped table is left with at least one
-- non-service-role permissive policy (user/org/admin/public scope).
-- service_role keeps full access via RLS bypass. Behaviour change: zero.
-- Advisor change: 210 → ~30 (the residual being legitimate multi-policy
-- combinations like family_members_manage + family_members_read which
-- are real overlaps that need application-level consolidation, NOT
-- redundant service-role drops).
--
-- ─── Verification (run manually after apply) ────────────────────────────────
-- mcp__supabase__get_advisors performance:
--   multiple_permissive_policies: 210 → ~30
--
-- Spot-check that user-scope policies still grant access:
--   SELECT count(*) FROM api_keys WHERE user_id = (SELECT auth.uid())
--   when called as authenticated → returns user's keys.
--   Same call as service_role → returns ALL keys (RLS bypass).
