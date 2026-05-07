-- Migration v110: lock down 19 remaining SECURITY DEFINER functions
-- (Phase 0.3 follow-up to v104)
--
-- v104 took the conservative first pass on 23 cron/scraper-only functions.
-- This migration handles the 19 user-callable RPCs deferred there, after
-- per-function grep audit confirmed every caller in apps/ and packages/
-- uses createServiceClient() for the .rpc() invocation. Direct verification:
--
--   create_organization, generate_org_api_key — apps/web/app/api/org/create/route.ts
--     → both: `serviceClient.rpc(...)`
--   generate_api_key_record — apps/web/app/api/keys/route.ts
--     → `serviceClient.rpc("generate_api_key_record", ...)`
--   create_scam_report, link_report_entity, upsert_scam_entity
--     → packages/scam-engine/src/report-store.ts (service_role)
--   get_extension_tier — apps/web/app/api/extension/subscription/route.ts (service)
--   get_user_org — apps/web/lib/org.ts (service)
--   phone_footprint_internal — packages/.../providers/internal.ts (service)
--   sync_phone_footprint_entitlements, sync_subscription_tier
--     — apps/web/app/api/stripe/webhook/route.ts (service, webhook-only)
--   upsert_push_token — apps/web/app/api/mobile/push/register/route.ts (service)
--   upsert_site_and_store_audit
--     — apps/web/app/api/site-audit/{stream,}/route.ts (both service)
--
-- Six functions have ZERO callers in app code today:
--   check_breach_exposure, get_dashboard_summary, get_jurisdiction_summary,
--   get_threat_intel_export, get_unreported_entities,
--   get_vulnerability_exposure_report
-- These are flag-gated for the breach-defence + B2B export features that
-- haven't shipped yet. When those features ship, the developer re-grants
-- EXECUTE explicitly. Revoking now closes the privilege-escalation surface
-- while the functions sit dormant.
--
-- service_role bypasses EXECUTE restrictions so backend code is unaffected.
-- All 19 functions retain service_role EXECUTE explicitly.
--
-- Closes the remaining 38 advisor WARNs (19 anon + 19 authenticated) on
-- the SECURITY_DEFINER_function_executable lints. Combined with v104,
-- this closes 134 of 134 — every SECURITY DEFINER function in the project
-- is now service_role-only by default.

DO $$
DECLARE
  funcs text[] := ARRAY[
    'check_breach_exposure',
    'create_organization',
    'create_scam_report',
    'generate_api_key_record',
    'generate_org_api_key',
    'get_dashboard_summary',
    'get_extension_tier',
    'get_jurisdiction_summary',
    'get_threat_intel_export',
    'get_unreported_entities',
    'get_user_org',
    'get_vulnerability_exposure_report',
    'link_report_entity',
    'phone_footprint_internal',
    'sync_phone_footprint_entitlements',
    'sync_subscription_tier',
    'upsert_push_token',
    'upsert_scam_entity',
    'upsert_site_and_store_audit'
  ];
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY(funcs)
  LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || fn.sig
      || ' FROM anon, authenticated, PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || fn.sig
      || ' TO service_role';
  END LOOP;
END $$;

-- Re-grant note for breach-defence consumer flow:
-- When NEXT_PUBLIC_FF_BD_PUBLIC_LOOKUP flips on, add:
--   GRANT EXECUTE ON FUNCTION public.check_breach_exposure(text, bytea) TO anon;
-- The other zero-caller functions (get_*) are admin/B2B only — they should
-- stay service_role-only and be invoked from authenticated admin routes
-- via createServiceClient().
