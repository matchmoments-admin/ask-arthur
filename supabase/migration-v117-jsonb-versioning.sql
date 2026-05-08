-- Migration v117: JSONB schema-version columns (Phase 4.4)
--
-- Adds `*_v SMALLINT NOT NULL DEFAULT 1` companion columns to 11 JSONB
-- columns across 10 tables. Purely additive — readers ignore the column
-- until a v2 schema ships and they need to branch on it. Writers can
-- continue to set nothing (default = 1).
--
-- The pattern protects against silent schema drift in JSONB blobs:
-- when Anthropic / Voyage / Stripe rolls a new payload shape, or when
-- our own Zod schemas bump major versions, the version column lets
-- readers explicitly branch (`if (row.metadata_v >= 2) { ...new shape... }`)
-- rather than ad-hoc `??` chains that silently miss field renames.
--
-- Column-name corrections from the original v3 plan after pre-flight:
--   - breach_sources_raw uses `raw_content` (the v80 column name), not
--     `payload` as the v2/v3 plan claimed.
--   - family_activity_log uses `metadata`, not `details`.
--
-- 0 row mutations. Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.scam_reports
  ADD COLUMN IF NOT EXISTS analysis_result_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.phone_footprints
  ADD COLUMN IF NOT EXISTS pillar_scores_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.phone_footprint_entitlements
  ADD COLUMN IF NOT EXISTS features_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.media_analyses
  ADD COLUMN IF NOT EXISTS deepfake_raw_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.breach_sources_raw
  ADD COLUMN IF NOT EXISTS raw_content_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.breaches
  ADD COLUMN IF NOT EXISTS sources_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.cost_telemetry
  ADD COLUMN IF NOT EXISTS metadata_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS metadata_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.family_activity_log
  ADD COLUMN IF NOT EXISTS metadata_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.reddit_intel_daily_summary
  ADD COLUMN IF NOT EXISTS emerging_threats_v SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.reddit_intel_daily_summary
  ADD COLUMN IF NOT EXISTS brand_watchlist_v SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.scam_reports.analysis_result_v IS
  'Schema version of analysis_result JSONB. v1 = AnalysisResultSchema in '
  '@askarthur/types as of 2026-05-08. Bump when the Claude analysis '
  'output shape changes; readers MUST branch on this column when v2+ ships.';

COMMENT ON COLUMN public.phone_footprints.pillar_scores_v IS
  'Schema version of pillar_scores JSONB. v1 = Footprint["pillars"] '
  'shape from buildPhoneFootprint() as of 2026-05-08. Bump when pillar '
  'definitions change.';

COMMENT ON COLUMN public.cost_telemetry.metadata_v IS
  'Schema version of metadata JSONB. v1 = hand-built per-call-site '
  'shapes (see logCost callers across web_analyze, twilio_lookup, '
  'phone_footprint_refresh, etc.) as of 2026-05-08. Centralisation '
  'into a shared CostMetadataSchema is a separate follow-up.';

COMMENT ON COLUMN public.subscriptions.metadata_v IS
  'Schema version of Stripe webhook metadata JSONB. v1 = Stripe API '
  'event payload shape as of 2026-05-08. Bump when Stripe API version '
  'pinned in /api/stripe/webhook/ changes.';

-- Verification (run manually after apply):
-- SELECT count(*) FROM information_schema.columns
-- WHERE table_schema='public' AND column_name LIKE '%\\_v' ESCAPE '\\'
--   AND data_type='smallint';
--   → ≥ 11
