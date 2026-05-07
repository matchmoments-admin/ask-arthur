-- Migration v104: REVOKE EXECUTE on cron/scraper-only SECURITY DEFINER functions
--
-- The Supabase advisor flags 48 SECURITY DEFINER functions with EXECUTE
-- granted to anon AND authenticated (96 advisor WARNs at 48 × 2 roles).
-- SECURITY DEFINER + broad EXECUTE = privilege-escalation surface area:
-- if a function has any unsafe input handling (e.g., dynamic SQL with
-- string concatenation, or relies on an attacker-controllable search_path),
-- a low-privilege caller can hijack the owner's privileges.
--
-- This migration locks down a CONSERVATIVE subset of 23 functions whose
-- ONLY callers are:
--   - Cron / Inngest jobs (which use service_role; service_role bypasses
--     the EXECUTE restriction).
--   - Python scrapers in pipeline/ that connect via direct postgres
--     credentials, NOT PostgREST (so role-level GRANTs don't apply).
--   - Postgres triggers (which run as the table owner, not the calling
--     role).
--   - Admin-only functions that should never be web-callable.
--
-- For each function, every TS / TSX caller in apps/ + packages/ was grep'd
-- and verified to use createServiceClient() (service_role). Functions with
-- ANY other client (anon / authenticated) are NOT in this PR and stay
-- queued for a follow-on per-function audit (the original 25 untouched).
--
-- Functions revoked (handles all overloads automatically via DO block):
--
--   Cron / Inngest only (service_role caller):
--     - anonymise_expired_footprints       (v100/PR #151 cron)
--     - sweep_inactive_monitors            (v100/PR #151 cron)
--     - cleanup_old_reddit_posts           (PR #151 cron)
--     - archive_old_urls                   (no caller in app code)
--     - archive_scam_reports_batch         (Vercel cron route, service_role)
--     - mark_stale_urls / _ips / _crypto_wallets (Inngest)
--     - upsert_feed_item                   (Inngest feed-sync)
--     - upsert_scam_url                    (extension/report-email, service_role verified)
--     - compute_entity_risk_score          (Inngest risk-scorer)
--     - log_api_usage                      (apiAuth.ts, service_role)
--
--   Scraper-only (Python via direct DB connection — bypasses PostgREST):
--     - bulk_upsert_feed_url (4 overloads)
--     - bulk_upsert_feed_ip
--     - bulk_upsert_feed_entity (3 overloads)
--     - bulk_upsert_feed_crypto_wallet (2 overloads)
--
--   Postgres-internal:
--     - handle_new_user                    (auth.users INSERT trigger)
--     - auto_add_owner_to_family           (trigger)
--
--   Admin-only or unused:
--     - set_user_admin                     (admin API only — DANGEROUS if web-callable)
--     - assert_fleet_capacity              (no caller)
--     - record_financial_impact            (no caller)
--     - submit_provider_report             (no caller)
--     - user_owns_key_hash                 (internal RLS helper)
--
-- DEFERRED to follow-up PR (need per-function caller audit):
--     check_breach_exposure (intended public-callable per audit comment;
--       flag-gated; revoke would break Phase 2 breach-defence consumer flow),
--     create_organization, create_scam_report, generate_api_key_record,
--     generate_org_api_key, get_dashboard_summary, get_extension_tier,
--     get_jurisdiction_summary, get_threat_intel_export,
--     get_unreported_entities, get_user_org, get_vulnerability_exposure_report,
--     link_report_entity, phone_footprint_internal,
--     sync_phone_footprint_entitlements, sync_subscription_tier,
--     upsert_push_token, upsert_scam_entity, upsert_site_and_store_audit
--
-- service_role bypasses EXECUTE restrictions, so all backend code that
-- uses createServiceClient() continues to work. The advisor will still
-- flag these because the lint is conservative (it warns on any SECURITY
-- DEFINER function with EXECUTE grants beyond service_role); a follow-up
-- PR will harden the remainder + document a CLAUDE.md rule for new
-- SECURITY DEFINER functions.

DO $$
DECLARE
  funcs text[] := ARRAY[
    'anonymise_expired_footprints',
    'sweep_inactive_monitors',
    'cleanup_old_reddit_posts',
    'archive_old_urls',
    'archive_scam_reports_batch',
    'mark_stale_urls',
    'mark_stale_ips',
    'mark_stale_crypto_wallets',
    'upsert_feed_item',
    'upsert_scam_url',
    'compute_entity_risk_score',
    'log_api_usage',
    'bulk_upsert_feed_url',
    'bulk_upsert_feed_ip',
    'bulk_upsert_feed_entity',
    'bulk_upsert_feed_crypto_wallet',
    'handle_new_user',
    'auto_add_owner_to_family',
    'set_user_admin',
    'assert_fleet_capacity',
    'record_financial_impact',
    'submit_provider_report',
    'user_owns_key_hash'
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
    -- Service_role keeps EXECUTE (it's a separate explicit grant);
    -- ensure that's still in place even if a future migration drops it.
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || fn.sig
      || ' TO service_role';
  END LOOP;
END $$;

-- ─── Verification (run manually after apply) ────────────────────────────────
-- SELECT routine_name,
--        array_agg(grantee::text ORDER BY grantee) AS grantees
-- FROM information_schema.routine_privileges
-- WHERE routine_schema='public'
--   AND privilege_type='EXECUTE'
--   AND routine_name IN ('anonymise_expired_footprints','set_user_admin', ...)
-- GROUP BY routine_name;
--   → grantees should be {service_role, postgres} for each.
--
-- mcp__supabase__get_advisors security:
--   anon_security_definer_function_executable: 48 → ~25 (the 23 deferred functions)
--   authenticated_security_definer_function_executable: 48 → ~25
