-- migration-v94b: lock down v94 surfaces against the security advisor.
--
-- Three findings from the v94 advisor pass:
--   1. ERROR: feedback_disagreement_24h view defaulted to SECURITY DEFINER.
--      Match the v78 pattern (today_cost_total, daily_cost_summary,
--      threat_intel_urls all set security_invoker = true).
--   2. WARN: feedback_triage_queue MV is selectable by anon/authenticated.
--      Only the admin page (service_role) and ad-hoc SQL Editor (postgres)
--      should read it — there's no consumer surface that needs anon access.
--   3. WARN: refresh_feedback_triage_queue() is callable as a SECURITY
--      DEFINER RPC by anon/authenticated via PostgREST. Only the Inngest
--      cron (service_role) should call it. REVOKE FROM PUBLIC in v94
--      didn't cover anon/authenticated explicitly.
--
-- Idempotent.

begin;

-- 1. Fix the SECURITY DEFINER view default.
alter view public.feedback_disagreement_24h set (security_invoker = true);

-- 2. Lock down the MV — service_role keeps implicit access; anon and
--    authenticated lose all rights.
revoke all on public.feedback_triage_queue from anon, authenticated;

-- 3. Lock down the refresh RPC. anon and authenticated had implicit
--    EXECUTE via Postgres defaults that REVOKE FROM PUBLIC doesn't
--    reach in Supabase's role hierarchy.
revoke execute on function public.refresh_feedback_triage_queue() from anon, authenticated;

commit;
