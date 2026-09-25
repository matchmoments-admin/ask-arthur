-- v323 — restrict audit and organization table reads (2026-09-25)
--
-- 1. site_audits / sites carried "Public read" policies (USING (true), role
--    public) plus Supabase's default table grants, so any holder of the public
--    anon key could list every row through PostgREST. Every reader and writer
--    in the codebase uses the service role (apps/web/app/scan/[token]/page.tsx,
--    lib/report.ts, lib/dashboard.ts, lib/scanner.ts, lib/badge/eligibility.ts;
--    writes via the SECURITY DEFINER upsert_site_and_store_audit), and no view
--    or function exposes them to anon/authenticated. Drop the public policies
--    and revoke all privileges from anon/authenticated; service_role is
--    unaffected.
--
-- 2. organizations.fleet_webhook_secret is readable by active org members
--    through "Members read own organization". It is only ever read server-side
--    (lib/phone-footprint/alert-dispatch.ts, service role). Column-level REVOKE
--    is inert while a table-level SELECT grant exists, so revoke table-level
--    SELECT and re-grant every other column to authenticated (the member read
--    policy still applies). anon has no read policy, so it gets no grant.
--
-- Idempotent: DROP POLICY IF EXISTS; REVOKE/GRANT are no-ops in target state.
-- Reverse: re-create the two policies and GRANT SELECT ON the tables.

DROP POLICY IF EXISTS "Public read site_audits" ON public.site_audits;
DROP POLICY IF EXISTS "Public read sites" ON public.sites;

REVOKE ALL ON public.site_audits, public.sites FROM anon, authenticated;

REVOKE SELECT ON public.organizations FROM anon, authenticated;
GRANT SELECT (
  id, name, slug, abn, abn_verified, abn_entity_name, domain, domain_verified,
  sector, tier, status, settings, created_at, updated_at, fleet_tier,
  fleet_seat_cap, fleet_webhook_url, fleet_refresh_interval
) ON public.organizations TO authenticated;

-- 3. Family invites (FF_FAMILY_PLAN dark): pending invites gain an expiry.
--    New invites default to 7 days; existing pending invites get
--    created_at + 7 days so a stale code cannot be redeemed forever. The join
--    route rejects expired codes and redeems atomically (joined_at IS NULL).
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.family_members
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
UPDATE public.family_members
   SET expires_at = created_at + interval '7 days'
 WHERE expires_at IS NULL AND joined_at IS NULL;
