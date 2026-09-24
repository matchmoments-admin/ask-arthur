-- v322 — tighten write privileges, follow-up to v321 (2026-09-24)
--
-- 1. api_keys: v321 re-granted UPDATE(is_active) to `authenticated` for the
--    key-revoke route. That route now revokes through the service role after an
--    explicit ownership check (apps/web/app/api/keys/[id]/route.ts), so no
--    user-scoped writer of api_keys remains and the column grant is removed:
--    key state is written only by the service role and the SECURITY DEFINER
--    key functions (generate_api_key_record, generate_org_api_key,
--    sync_subscription_tier).
--
-- 2. The same table-level default grants v321 removed from the account tables
--    are removed from the remaining tables that hold membership, entitlement or
--    billing state. Every app writer of each table was traced before this was
--    written (2026-09-24) and all use createServiceClient() or a SECURITY
--    DEFINER function; mobile, extension and edge functions do not write them;
--    no SECURITY INVOKER function executable by `authenticated` writes them:
--      org_invitations         — /api/org/invite, /api/org/invite/accept
--      phone_footprint_monitors — /api/phone-footprint/monitors[/id], Inngest
--      family_groups, family_members — /api/family, /family/invite, /family/join
--      organizations           — Stripe webhook, invite accept (service role)
--      subscriptions, extension_subscriptions — Stripe webhook, /api/extension/link
--    DELETE for `authenticated` stays governed by RLS (unchanged).
--
-- Idempotent: REVOKE is a no-op when the privilege is already absent.

REVOKE UPDATE (is_active) ON public.api_keys FROM authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.org_invitations,
     public.phone_footprint_monitors,
     public.family_groups,
     public.family_members,
     public.organizations,
     public.subscriptions,
     public.extension_subscriptions
  FROM anon;

REVOKE INSERT, UPDATE, TRUNCATE
  ON public.org_invitations,
     public.phone_footprint_monitors,
     public.family_groups,
     public.family_members,
     public.organizations,
     public.subscriptions,
     public.extension_subscriptions
  FROM authenticated;
