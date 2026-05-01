-- Migration v82: Reddit Scam Intelligence base schema.
--
-- Why: the daily Reddit scrape (pipeline/scrapers/reddit_scams.py) writes
-- IOCs to feed_items but discards the narrative content of each post —
-- modus operandi, brand impersonations, victim phrasing, week-on-week
-- novelty. This migration provisions the storage layer for the Sonnet 4.6
-- batch classifier (Wave 1) and the greedy pgvector clustering job (Wave 2).
--
-- Plan: docs/plans/reddit-intel.md.
--
-- Schema design:
--   * One reddit_post_intel row per feed_items row of source='reddit'. UNIQUE
--     constraint on feed_item_id makes the daily classifier idempotent.
--   * intent_label CHECK matches feed_items.category enum verbatim (D5 in
--     the plan) — keeping a single ACCC-aligned taxonomy avoids permanent
--     sync toil.
--   * pgvector with IVFFlat (D4): at <50k vectors HNSW's higher build cost
--     and memory overhead don't pay off. Switch to HNSW only if recall on
--     theme lookups becomes a problem.
--   * Themes are cluster heads; reddit_post_intel.theme_id and the
--     reddit_post_intel_themes membership table both reference them. The
--     direct theme_id pointer captures the primary cluster; the membership
--     table allows multi-membership when posts span themes.
--   * RLS enabled on every table; service-role-only writes. No anon access
--     (the dashboard reads via the web app's service role, not direct
--     PostgREST).
--
-- Idempotent: re-running adds nothing new.

-- 1. pgvector — required for embedding columns and similarity search.
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. reddit_post_intel — narrative classification per Reddit feed_item.
CREATE TABLE IF NOT EXISTS reddit_post_intel (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_item_id       BIGINT NOT NULL UNIQUE
                     REFERENCES feed_items(id) ON DELETE CASCADE,

  -- Primary classification (always set). intent_label matches the
  -- feed_items.category enum verbatim — keep these in sync.
  intent_label       TEXT NOT NULL CHECK (intent_label IN (
                       'phishing', 'romance_scam', 'investment_fraud',
                       'tech_support', 'impersonation', 'shopping_scam',
                       'phone_scam', 'email_scam', 'sms_scam',
                       'employment_scam', 'advance_fee', 'rental_scam',
                       'sextortion', 'informational', 'other'
                     )),
  confidence         NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),

  -- Narrative metadata (free-text, NULL after 180-day retention scrub per
  -- F-13). The structured columns above are retained indefinitely.
  modus_operandi     TEXT,
  brands_impersonated TEXT[] DEFAULT '{}',
  victim_emotion     TEXT,
  novelty_signals    TEXT[] DEFAULT '{}',
  tactic_tags        TEXT[] DEFAULT '{}',
  country_hints      TEXT[] DEFAULT '{}',
  narrative_summary  TEXT,

  -- Theme assignment (Wave 2). Set by the clustering job; NULL until the
  -- first cluster pass after a post is classified.
  theme_id           UUID,                      -- FK added below after themes table

  -- Vector for similarity / clustering. NULL until embed step runs.
  embedding          VECTOR(1024),

  -- Versioning — bump model_version when swapping Sonnet model IDs;
  -- bump prompt_version when changing the system prompt or schema.
  model_version      TEXT NOT NULL,
  prompt_version     TEXT NOT NULL,

  processed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rpi_intent_label
  ON reddit_post_intel(intent_label);
CREATE INDEX IF NOT EXISTS idx_rpi_processed_at
  ON reddit_post_intel(processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rpi_brands
  ON reddit_post_intel USING GIN (brands_impersonated);
CREATE INDEX IF NOT EXISTS idx_rpi_theme_id
  ON reddit_post_intel(theme_id) WHERE theme_id IS NOT NULL;

-- IVFFlat for similarity. Built lazily — first ANN query after enough rows
-- exist will use it. lists=100 is the sweet spot for ≤100k vectors per
-- pgvector docs; we'll be well below that.
CREATE INDEX IF NOT EXISTS idx_rpi_embedding_ivfflat
  ON reddit_post_intel USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding IS NOT NULL;

-- 3. reddit_intel_themes — cluster heads.
CREATE TABLE IF NOT EXISTS reddit_intel_themes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  narrative          TEXT,
  modus_operandi     TEXT,
  representative_brands TEXT[] DEFAULT '{}',

  -- Centroid vector — recomputed when membership changes by ≥10%.
  centroid_embedding VECTOR(1024),

  -- Rolling stats (refreshed by the trends job).
  member_count       INTEGER NOT NULL DEFAULT 0,
  ioc_url_count      INTEGER NOT NULL DEFAULT 0,
  ioc_phone_count    INTEGER NOT NULL DEFAULT 0,
  ioc_wallet_count   INTEGER NOT NULL DEFAULT 0,

  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  wow_delta_pct      NUMERIC(6,2),
  signal_strength    TEXT NOT NULL DEFAULT 'weak'
                     CHECK (signal_strength IN ('noise','weak','strong')),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rit_active_signal
  ON reddit_intel_themes(signal_strength, is_active)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_rit_last_seen
  ON reddit_intel_themes(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_rit_centroid_ivfflat
  ON reddit_intel_themes USING ivfflat (centroid_embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE centroid_embedding IS NOT NULL;

-- Backfill the FK now that the themes table exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reddit_post_intel_theme_id_fkey'
  ) THEN
    ALTER TABLE reddit_post_intel
      ADD CONSTRAINT reddit_post_intel_theme_id_fkey
      FOREIGN KEY (theme_id) REFERENCES reddit_intel_themes(id) ON DELETE SET NULL;
  END IF;
END$$;

-- 4. reddit_post_intel_themes — multi-membership join. The primary theme is
--    also stored on reddit_post_intel.theme_id for fast single-lookup; this
--    table captures secondary memberships when a post spans clusters.
CREATE TABLE IF NOT EXISTS reddit_post_intel_themes (
  intel_id    UUID NOT NULL REFERENCES reddit_post_intel(id) ON DELETE CASCADE,
  theme_id    UUID NOT NULL REFERENCES reddit_intel_themes(id) ON DELETE CASCADE,
  similarity  NUMERIC(4,3) NOT NULL CHECK (similarity BETWEEN 0 AND 1),
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (intel_id, theme_id)
);

CREATE INDEX IF NOT EXISTS idx_rpit_theme_id
  ON reddit_post_intel_themes(theme_id, similarity DESC);

-- 5. reddit_intel_quotes — extracted PII-scrubbed quotes (≤140 chars per
--    Reddit ToS / Australian fair-dealing guidance). DELETE after 365 days
--    per F-13 retention.
CREATE TABLE IF NOT EXISTS reddit_intel_quotes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_item_id  BIGINT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  intel_id      UUID NOT NULL REFERENCES reddit_post_intel(id) ON DELETE CASCADE,
  quote_text    TEXT NOT NULL CHECK (char_length(quote_text) <= 140),
  speaker_role  TEXT CHECK (speaker_role IN ('victim','scammer','witness','unknown')),
  theme_tag     TEXT,
  confidence    NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_riq_feed_item
  ON reddit_intel_quotes(feed_item_id);
CREATE INDEX IF NOT EXISTS idx_riq_intel_id
  ON reddit_intel_quotes(intel_id);            -- needed for cascade-delete perf
CREATE INDEX IF NOT EXISTS idx_riq_created_at
  ON reddit_intel_quotes(created_at DESC);

-- 6. reddit_intel_daily_summary — Sonnet-generated daily lead narrative
--    plus aggregate stats. One row per (cohort_date, audience, country_code).
CREATE TABLE IF NOT EXISTS reddit_intel_daily_summary (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_date       DATE NOT NULL,
  audience          TEXT NOT NULL CHECK (audience IN ('public','b2c','b2b','internal')),
  country_code      TEXT,                            -- NULL = all
  lead_narrative    TEXT NOT NULL,                   -- 200-300 words
  emerging_threats  JSONB NOT NULL DEFAULT '[]'::jsonb,
  brand_watchlist   JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats             JSONB NOT NULL DEFAULT '{}'::jsonb,
  posts_classified  INTEGER NOT NULL DEFAULT 0,
  model_version     TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cohort_date, audience, country_code)
);

CREATE INDEX IF NOT EXISTS idx_rids_cohort_audience
  ON reddit_intel_daily_summary(cohort_date DESC, audience);

-- 7. RLS — service-role-only writes; no anon access.
ALTER TABLE reddit_post_intel        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reddit_intel_themes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reddit_post_intel_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reddit_intel_quotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reddit_intel_daily_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reddit_post_intel_service_all ON reddit_post_intel;
CREATE POLICY reddit_post_intel_service_all ON reddit_post_intel
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS reddit_intel_themes_service_all ON reddit_intel_themes;
CREATE POLICY reddit_intel_themes_service_all ON reddit_intel_themes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS reddit_post_intel_themes_service_all ON reddit_post_intel_themes;
CREATE POLICY reddit_post_intel_themes_service_all ON reddit_post_intel_themes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS reddit_intel_quotes_service_all ON reddit_intel_quotes;
CREATE POLICY reddit_intel_quotes_service_all ON reddit_intel_quotes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS reddit_intel_daily_summary_service_all ON reddit_intel_daily_summary;
CREATE POLICY reddit_intel_daily_summary_service_all ON reddit_intel_daily_summary
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. Comments for posterity (visible in Supabase studio + pg_dump).
COMMENT ON TABLE reddit_post_intel IS
  'Per-post narrative classification of Reddit feed_items. Written by the daily Sonnet 4.6 batch classifier. See docs/plans/reddit-intel.md.';
COMMENT ON TABLE reddit_intel_themes IS
  'Cluster heads for Reddit narrative themes. Greedy pgvector assignment (cosine ≥ 0.78); IVFFlat index. See docs/plans/reddit-intel.md.';
COMMENT ON TABLE reddit_intel_daily_summary IS
  'Sonnet-generated daily lead narrative + aggregate stats. Source of truth for the dashboard hero banner and weekly email.';
