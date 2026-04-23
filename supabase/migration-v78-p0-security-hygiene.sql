-- Migration v78: P0 database security hygiene
--
-- Clears the 13 advisor ERRORs + the 42 project-function search_path WARNs
-- surfaced by the 2026-04-23 audit. Deferred items (177 unused indexes,
-- 21 empty partitioned shadows, 16 USING(true) rewrites, pg_trgm schema move,
-- and Phase 1 commercial tables) are tracked in BACKLOG.md under
-- "Database Hygiene & SPF Readiness" and get their own PRs.
--
-- Numbering note: v75/v76/v77 are taken by the phone-footprint sprint
-- (parallel branch). This migration was originally applied to the
-- Supabase project (rquomhcgnodxzkhokwni) as 'v75_p0_security_hygiene' on
-- 2026-04-24 — the DB record name is historical and harmless; the file is
-- renumbered to v78 so the two branches don't collide on merge.
--
-- R&D context: SPF designated-sector commencement is 2026-07-01 (~70 days
-- out). Every Big-Four/mid-tier bank InfoSec review starts by running the
-- platform host's own advisor output, so the 10 RLS-disabled tables, 3
-- SECURITY DEFINER views, and mutable-search-path functions are a hard
-- disqualifier today. This migration resolves them without touching
-- application code — readers/writers are all service-role (audited across
-- apps/web, packages/scam-engine, pipeline/scrapers on 2026-04-24) so RLS
-- with no anon/authenticated policies is deny-all for those roles and a
-- no-op for the service client.
--
-- Idempotent: safe to re-apply.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on 10 public tables (ERROR: rls_disabled_in_public)
--
-- Service role bypasses RLS so all current callers (createServiceClient in
-- apps/web + packages/scam-engine, service-role Python scrapers) keep
-- working. No anon/authenticated policies are created — that means anon
-- and authenticated are blocked, which matches the confirmed zero-usage
-- audit. Also revoke table-level grants as defence in depth; RLS is the
-- primary control.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'brand_impersonation_alerts',
    'device_push_tokens',
    'scan_results',
    'known_brands',
    'extension_subscriptions',
    'phone_reputation',
    'feed_summaries',
    'extension_installs',
    'feature_brakes',
    'verdict_feedback'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Convert SECURITY DEFINER views → security_invoker (ERROR: security_definer_view)
--
-- daily_cost_summary and today_cost_total power /admin/costs which reads via
-- createServiceClient — service_role bypasses RLS so the underlying
-- cost_telemetry reads still succeed. threat_intel_urls reads scam_urls
-- which currently has a USING(true) RLS policy (queued for rewrite in
-- BACKLOG), so the view keeps working for any caller.
-- ---------------------------------------------------------------------------

ALTER VIEW public.today_cost_total SET (security_invoker = true);
ALTER VIEW public.daily_cost_summary SET (security_invoker = true);
ALTER VIEW public.threat_intel_urls SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 3. Pin search_path on 41 project-owned functions (WARN: function_search_path_mutable)
--
-- The other ~32 advisor hits in this category are pg_trgm extension
-- functions (gin_*, gtrgm_*, similarity*, word_similarity*). The correct
-- fix for those is relocating the extension out of public — deferred to
-- BACKLOG because it touches every SQL site that references similarity().
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.archive_old_urls(integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.auto_add_owner_to_family() SET search_path = public, pg_catalog;
ALTER FUNCTION public.auto_escalate_flagged_ad() SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_crypto_wallet(text, text, text, text, text, text, timestamp with time zone, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_crypto_wallet(text, text, text, text, text, text, timestamp with time zone, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_entity(text, text, text, text, timestamp with time zone, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_entity(text, text, text, text, timestamp with time zone, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_entity(text, text, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_ip(inet, integer, integer, integer, text, text, text, integer, text, timestamp with time zone, text, timestamp with time zone, timestamp with time zone) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_url(text, text, text, text, text, text, text, text, timestamp with time zone, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_url(text, text, text, text, text, text, text, text, timestamp with time zone) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_url(text, text, text, text, text, text, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.bulk_upsert_feed_url(text, text, text, text, text, text, text, text, timestamp with time zone, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.cleanup_old_reddit_posts(integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.compute_entity_risk_score(bigint) SET search_path = public, pg_catalog;
ALTER FUNCTION public.create_scam_report(text, text, text, text, real, text, text, text, text, text, jsonb, bigint, text, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.ensure_monthly_partition(text, date) SET search_path = public, pg_catalog;
ALTER FUNCTION public.ensure_next_month_partitions() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fraud_manager_search(text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.generate_api_key_record(uuid, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.generate_org_api_key(uuid, uuid, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_extension_tier(text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_user_org(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.increment_celebrity_detection_count() SET search_path = public, pg_catalog;
ALTER FUNCTION public.increment_check_stats(text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.link_report_entity(bigint, bigint, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.log_api_usage(text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.mark_stale_crypto_wallets(integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.mark_stale_ips(integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.mark_stale_urls(integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_user_admin(uuid, boolean) SET search_path = public, pg_catalog;
ALTER FUNCTION public.sync_subscription_tier(bigint, text, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.trigger_entity_enrichment_pending() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_leads_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_media_analyses_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_organizations_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.upsert_push_token(text, text, text, text, uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.upsert_scam_entity(text, text, text, bigint, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.upsert_scam_url(text, text, text, text, text, text, text, text, text, text, text, bigint) SET search_path = public, pg_catalog;
ALTER FUNCTION public.upsert_scan_result(text, text, text, integer, text, jsonb, text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.upsert_site_and_store_audit(text, text, integer, text, jsonb, jsonb, text[], integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.user_owns_key_hash(text) SET search_path = public, pg_catalog;

-- ---------------------------------------------------------------------------
-- 4. Index hygiene (WARN: duplicate_index, INFO: unindexed_foreign_keys)
--
-- Duplicate-index pair per table is byte-for-byte identical (confirmed via
-- pg_indexes.indexdef on 2026-04-24). Keep the shorter name, drop the
-- other. Tables are tiny today so CONCURRENTLY is unnecessary; a normal
-- DROP INDEX is acceptable inside the transaction.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_api_usage_log_key_date;
DROP INDEX IF EXISTS public.idx_feed_ingestion_log_feed;

CREATE INDEX IF NOT EXISTS idx_deepfake_detections_flagged_ad_id
  ON public.deepfake_detections(flagged_ad_id);
CREATE INDEX IF NOT EXISTS idx_family_activity_log_member_id
  ON public.family_activity_log(member_id);
CREATE INDEX IF NOT EXISTS idx_family_groups_owner_id
  ON public.family_groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_invited_by
  ON public.org_invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_org_members_invited_by
  ON public.org_members(invited_by);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions(user_id);

COMMIT;
