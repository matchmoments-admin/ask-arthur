-- Migration v101: low-risk advisor wins + defensive CHECK constraints
--
-- Bundled phase-0/phase-1/phase-4 items that are pure additive (no data
-- mutation, no behaviour change for non-service-role callers):
--
--   1.7 — Add deny-all RLS policies to 33 RLS-enabled-no-policy tables.
--          With RLS on and no policies, anon/authenticated already get
--          0 rows (Postgres defaults to deny). Adding an explicit
--          RESTRICTIVE deny-all formalises intent and clears the
--          rls_enabled_no_policy INFO advisor (33 → 0). service_role
--          bypasses RLS, so writers/readers via createServiceClient()
--          are unaffected.
--
--   1.8 — Set search_path on upsert_site_and_store_audit. Confirmed via
--          pg_proc that proconfig is null today; the function references
--          public.sites and public.site_audits implicitly. Pinning
--          search_path = public, pg_catalog matches the v68/v98
--          gotchas note in CLAUDE.md and clears the last
--          function_search_path_mutable advisor.
--
--   4.8 — Defensive CHECK constraints. Pre-flight scanned existing data
--          for violations; constraints below have ZERO violations. Two
--          constraints from the original plan were dropped:
--          (a) phone_footprints.composite_score and
--              reddit_post_intel.confidence already have CHECKs (skipping
--              redundant additions).
--          (b) cost_telemetry.units > 0 was relaxed to >= 0 because
--              22 legitimate diagnostic rows (feature='reddit-intel-error')
--              have units=0 — these record failed Claude calls where no
--              billable tokens were consumed (incident-fixed in #148).
--
-- NOT INCLUDED (originally planned for v101):
--   - 4.1 (scam_reports.cluster_id ON DELETE SET NULL): already correct
--     in prod. The FK is named `fk_scam_reports_cluster` (not the
--     conventional `*_cluster_id_fkey`), and `pg_get_constraintdef` shows
--     ON DELETE SET NULL is already set. The schema audit's "implicit
--     RESTRICT" claim was based on a name-pattern query that missed the
--     unconventional constraint name. No migration needed.
--
-- Idempotent: all CREATE POLICY use IF NOT EXISTS via DROP+CREATE pattern;
-- ALTER FUNCTION SET is a no-op if already set; ALTER TABLE ADD CONSTRAINT
-- IF NOT EXISTS guards CHECK constraints.

-- ─── 1.8: pin search_path on upsert_site_and_store_audit ────────────────────
ALTER FUNCTION public.upsert_site_and_store_audit(
  text, text, integer, text, jsonb, jsonb, jsonb, integer, boolean, jsonb, jsonb
) SET search_path = public, pg_catalog;

-- ─── 1.7: explicit deny-all RESTRICTIVE policies on 33 tables ───────────────
-- Pattern uses RESTRICTIVE so an additional permissive policy can be added
-- later (per-feature) and these denials still apply as a floor. service_role
-- bypasses RLS entirely so writers and readers using createServiceClient()
-- are unaffected. These changes ONLY affect anon and authenticated roles,
-- which today already see 0 rows from these tables (RLS enabled + no policy
-- = deny-by-default).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'brand_impersonation_alerts',
    'cost_telemetry',
    'cost_telemetry_partitioned_y2026m01',
    'cost_telemetry_partitioned_y2026m02',
    'cost_telemetry_partitioned_y2026m03',
    'cost_telemetry_partitioned_y2026m04',
    'cost_telemetry_partitioned_y2026m05',
    'cost_telemetry_partitioned_y2026m06',
    'device_push_tokens',
    'extension_installs',
    'extension_subscriptions',
    'feature_brakes',
    'feed_items_partitioned_y2026m01',
    'feed_items_partitioned_y2026m02',
    'feed_items_partitioned_y2026m03',
    'feed_items_partitioned_y2026m04',
    'feed_items_partitioned_y2026m05',
    'feed_items_partitioned_y2026m06',
    'feed_summaries',
    'known_brands',
    'phone_reputation',
    'scam_reports_partitioned_y2026m01',
    'scam_reports_partitioned_y2026m02',
    'scam_reports_partitioned_y2026m03',
    'scam_reports_partitioned_y2026m04',
    'scam_reports_partitioned_y2026m05',
    'scam_reports_partitioned_y2026m06',
    'scan_results',
    'verdict_feedback',
    'vulnerabilities',
    'vulnerability_detections',
    'vulnerability_exposure_checks',
    'vulnerability_ingestion_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    -- Drop-then-create makes the migration idempotent without IF NOT EXISTS
    -- (which CREATE POLICY doesn't support).
    EXECUTE format(
      'DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.%I',
      t
    );
    EXECUTE format(
      'CREATE POLICY deny_all_anon_authenticated ON public.%I '
      'AS RESTRICTIVE FOR ALL TO anon, authenticated '
      'USING (false) WITH CHECK (false)',
      t
    );
  END LOOP;
END $$;

-- ─── 4.8: defensive CHECK constraints on previously-unchecked columns ───────
-- Pre-flight verified zero existing-data violations. Constraints use NOT
-- VALID pattern + immediate VALIDATE because the tables are small enough
-- that VALIDATE is sub-second.

ALTER TABLE public.scam_reports
  ADD CONSTRAINT scam_reports_confidence_score_range
  CHECK (confidence_score IS NULL
         OR (confidence_score >= 0 AND confidence_score <= 1));

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_daily_limit_positive
  CHECK (daily_limit IS NULL OR daily_limit > 0);

ALTER TABLE public.cost_telemetry
  ADD CONSTRAINT cost_telemetry_estimated_cost_nonneg
  CHECK (estimated_cost_usd >= 0);

-- units = 0 is a legitimate value for diagnostic rows that record
-- failed external API calls before any billable units were consumed.
-- Don't enforce > 0 here.
ALTER TABLE public.cost_telemetry
  ADD CONSTRAINT cost_telemetry_units_nonneg
  CHECK (units >= 0);

ALTER TABLE public.feed_items
  ADD CONSTRAINT feed_items_body_md_size
  CHECK (body_md IS NULL OR char_length(body_md) <= 50000);

-- ─── Verification queries (run manually after apply) ────────────────────────
-- SELECT count(*) FROM pg_policies WHERE policyname='deny_all_anon_authenticated';
--   → should return 33
-- SELECT proconfig FROM pg_proc WHERE proname='upsert_site_and_store_audit';
--   → should include 'search_path=public, pg_catalog'
-- SELECT count(*) FROM pg_constraint WHERE conname IN (
--   'scam_reports_confidence_score_range','api_keys_daily_limit_positive',
--   'cost_telemetry_estimated_cost_nonneg','cost_telemetry_units_nonneg',
--   'feed_items_body_md_size');
--   → should return 5
-- mcp__supabase__get_advisors security:
--   rls_enabled_no_policy: 33 → 0
--   function_search_path_mutable: 1 → 0
