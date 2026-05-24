-- Migration v142: infra_cost_daily RLS policy
--
-- Background: v134 introduced infra_cost_daily for tracking aggregate
-- infrastructure spend (Vercel CPU-min, Supabase compute, Cloudflare R2,
-- etc.) with RLS ENABLED but zero policies. Service-role connections bypass
-- RLS via the BYPASSRLS attribute on the supabase_admin role, so the table
-- works in practice — but the advisor flags the empty-policy state as a
-- security INFO and the configuration is ambiguous to future readers
-- ("does this work because of an implicit deny, or because every role is
-- service-role?").
--
-- This migration makes the intent explicit: only the service role reads or
-- writes infra_cost_daily. The /admin/costs dashboard already uses the
-- service-role client; consumer surfaces never touch this table.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY is safe to re-run.

DROP POLICY IF EXISTS "service_role_manages_infra_cost_daily"
  ON public.infra_cost_daily;

CREATE POLICY "service_role_manages_infra_cost_daily"
  ON public.infra_cost_daily
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
