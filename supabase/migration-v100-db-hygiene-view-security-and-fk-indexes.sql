-- Migration v100: DB hygiene — feed_items_all security_invoker + 11 missing FK indexes
--
-- Two unrelated-but-adjacent advisor cleanups bundled into one migration because
-- both are pure additive / security fixes with zero data-loss risk.
--
-- 1. feed_items_all view (created in v98) is the only remaining view in the
--    project missing `security_invoker = true`. v72 fixed scam_reports_all, v78
--    fixed today_cost_total / daily_cost_summary / threat_intel_urls, v94b
--    fixed feedback_disagreement_24h. v98 introduced a regression by creating
--    feed_items_all without the flag — this is the sole remaining ERROR-level
--    Supabase advisor finding (security_definer_view).
--
--    The view is referenced by zero web/app code paths (grep confirms it is an
--    operator-only convenience union over feed_items + feed_items_archive).
--    Flipping security_invoker has no functional effect on current callers but
--    closes the privilege-escalation-via-view path and clears the advisor.
--
-- 2. Supabase performance advisor flags 11 FK columns without supporting
--    indexes. Without an index on the referencing column, every parent-side
--    DELETE/UPDATE seq-scans the child. All 11 affected child tables are
--    currently small (phone_footprint_* and telco_* tables are 0 rows pending
--    Vonage live; breaches/breach_sources_raw are 0 rows pending breach-defence
--    backfill decision). Indexing them now is forward-looking and costs nothing
--    today.
--
-- Both changes are idempotent. Re-applying this migration is a no-op.

-- ─── 1. feed_items_all view: security_invoker = true ─────────────────────────
ALTER VIEW public.feed_items_all SET (security_invoker = true);

-- ─── 2. Foreign-key indexes (11 total) ───────────────────────────────────────
-- Not using CONCURRENTLY because mcp__supabase__apply_migration wraps in a
-- transaction and CONCURRENTLY can't run in one. All target tables are
-- currently 0 rows or near-0 rows, so non-concurrent CREATE INDEX is
-- effectively free.

CREATE INDEX IF NOT EXISTS idx_breach_sources_raw_verified_by
  ON public.breach_sources_raw (verified_by);

CREATE INDEX IF NOT EXISTS idx_breaches_created_by
  ON public.breaches (created_by);

CREATE INDEX IF NOT EXISTS idx_breaches_last_edited_by
  ON public.breaches (last_edited_by);

CREATE INDEX IF NOT EXISTS idx_phone_footprint_alerts_next_footprint_id
  ON public.phone_footprint_alerts (next_footprint_id);

CREATE INDEX IF NOT EXISTS idx_phone_footprint_alerts_prev_footprint_id
  ON public.phone_footprint_alerts (prev_footprint_id);

CREATE INDEX IF NOT EXISTS idx_phone_footprint_monitors_last_footprint_id
  ON public.phone_footprint_monitors (last_footprint_id);

CREATE INDEX IF NOT EXISTS idx_phone_footprint_otp_attempts_user_id
  ON public.phone_footprint_otp_attempts (user_id);

CREATE INDEX IF NOT EXISTS idx_telco_api_usage_org_id
  ON public.telco_api_usage (org_id);

CREATE INDEX IF NOT EXISTS idx_telco_api_usage_user_id
  ON public.telco_api_usage (user_id);

CREATE INDEX IF NOT EXISTS idx_telco_webhook_subscriptions_org_id
  ON public.telco_webhook_subscriptions (org_id);

CREATE INDEX IF NOT EXISTS idx_telco_webhook_subscriptions_user_id
  ON public.telco_webhook_subscriptions (user_id);

-- ─── Verification (run manually after apply) ─────────────────────────────────
-- SELECT c.relname, c.reloptions FROM pg_class c
-- JOIN pg_namespace n ON n.oid=c.relnamespace
-- WHERE n.nspname='public' AND c.relname='feed_items_all';
-- → reloptions should include 'security_invoker=true'
--
-- SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'idx_breach%' OR indexname LIKE 'idx_phone_footprint_%' OR indexname LIKE 'idx_telco_%';
-- → should return ≥ 11
--
-- SELECT * FROM pg_get_advisors(...);
-- → security ERROR count = 0 ; performance unindexed_foreign_keys count = 0
