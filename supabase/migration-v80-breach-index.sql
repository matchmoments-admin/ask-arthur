-- Migration v80: Breach Defence Suite — AU Breach Index spine.
--
-- Why:
--   Establishes the canonical record of every notifiable Australian data
--   breach (the `breaches` table) plus the pseudonymous victim lookup index
--   (`breach_victims_index`) and a raw-source provenance table
--   (`breach_sources_raw`) used by the OAIC NDB scraper, ransomware DLS
--   scrapers, and editor admin UI. All downstream Breach Defence features
--   (F2 extension warning, F4 lookup, F5 B2B exposure, F6 class actions,
--   F7 Aftermath pages, F9 Breach Score, F10 recovery, F11 second-wave)
--   join to this spine, so it must ship before any of them.
--
-- Privacy contract:
--   - `breach_victims_index` never stores raw email or AU document numbers.
--     Only SHA-256(normalised_input) and the breach link.
--   - `check_breach_exposure(...)` RPC is the only safe way for client code
--     to query the index — it returns matches without exposing the hash
--     itself or unrelated rows. Direct SELECT on the index is service-role
--     only (RLS).
--
-- Idempotency:
--   - All tables CREATE TABLE IF NOT EXISTS.
--   - All policies DROP POLICY IF EXISTS … CREATE POLICY … so re-running
--     is safe.
--   - Trigger function uses CREATE OR REPLACE; trigger uses DROP TRIGGER IF
--     EXISTS … CREATE TRIGGER …
--
-- Spec ref: ~/.claude/plans/humble-noodling-anchor.md PR #2 + Breach Defence
-- Suite spec §2.1, §2.2, F4.

BEGIN;

-- =============================================================================
-- 1. breaches — canonical record of every notifiable AU breach
-- =============================================================================

CREATE TABLE IF NOT EXISTS breaches (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Identification
  slug              TEXT NOT NULL UNIQUE,
  entity_name       TEXT NOT NULL,
  entity_domain     TEXT,
  abn               TEXT,
  asic_acn          TEXT,
  industry          TEXT,
  industry_code     TEXT,
  jurisdiction      TEXT NOT NULL DEFAULT 'AU',
  state             TEXT,

  -- Timeline
  discovered_at     TIMESTAMPTZ,
  disclosed_at      TIMESTAMPTZ,
  dls_listed_at     TIMESTAMPTZ,
  oaic_notified_at  TIMESTAMPTZ,

  -- Threat actor
  threat_actor      TEXT,
  threat_actor_type TEXT CHECK (threat_actor_type IN
                      ('ransomware','data_extortion','nation_state',
                       'insider','accidental','unknown')),
  attack_vector     TEXT,
  ransom_demanded   NUMERIC(12,2),
  ransom_currency   TEXT DEFAULT 'USD',

  -- Impact
  victim_count_claimed   INTEGER,
  victim_count_confirmed INTEGER,
  data_volume_gb         NUMERIC(10,2),
  data_classes      TEXT[] NOT NULL DEFAULT '{}',
  au_doc_classes    TEXT[] NOT NULL DEFAULT '{}',

  -- Status
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN
                      ('active','resolved','disputed','unconfirmed','rescinded')),
  ndb_status        TEXT CHECK (ndb_status IN
                      ('not_required','pending','submitted','published','rejected')),
  data_published    BOOLEAN DEFAULT false,

  -- Sources
  sources           JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_source_url TEXT,

  -- Editorial
  summary           TEXT,
  recovery_advice   TEXT,
  is_published      BOOLEAN NOT NULL DEFAULT false,
  is_redacted       BOOLEAN NOT NULL DEFAULT false,
  redaction_reason  TEXT,

  -- Audit
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id),
  last_edited_by    UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_breaches_domain
  ON breaches (entity_domain);
CREATE INDEX IF NOT EXISTS idx_breaches_abn
  ON breaches (abn) WHERE abn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_breaches_disclosed_at
  ON breaches (disclosed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_breaches_threat_actor
  ON breaches (threat_actor);
CREATE INDEX IF NOT EXISTS idx_breaches_industry
  ON breaches (industry_code);
CREATE INDEX IF NOT EXISTS idx_breaches_published
  ON breaches (is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_breaches_data_classes
  ON breaches USING GIN (data_classes);
CREATE INDEX IF NOT EXISTS idx_breaches_au_doc_classes
  ON breaches USING GIN (au_doc_classes);

-- Per-table updated_at trigger (matches v55 update_organizations_updated_at
-- pattern — there is no global set_updated_at function in this codebase).
CREATE OR REPLACE FUNCTION update_breaches_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_breaches_updated_at ON breaches;
CREATE TRIGGER trg_breaches_updated_at
  BEFORE UPDATE ON breaches
  FOR EACH ROW EXECUTE FUNCTION update_breaches_updated_at();

ALTER TABLE breaches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published breaches" ON breaches;
CREATE POLICY "Public read published breaches" ON breaches
  FOR SELECT
  USING (is_published = true AND is_redacted = false);

DROP POLICY IF EXISTS "Service role manage breaches" ON breaches;
CREATE POLICY "Service role manage breaches" ON breaches
  FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins manage breaches" ON breaches;
CREATE POLICY "Admins manage breaches" ON breaches
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- =============================================================================
-- 2. breach_victims_index — pseudonymous victim lookup (HIBP-style)
-- =============================================================================
-- Stores SHA-256(normalised_input) only, never raw PII. The check_breach_exposure
-- RPC defined below is the only safe way to query this — direct SELECT is
-- service-role only via RLS.

CREATE TABLE IF NOT EXISTS breach_victims_index (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  breach_id       BIGINT NOT NULL REFERENCES breaches(id) ON DELETE CASCADE,

  identifier_type TEXT NOT NULL CHECK (identifier_type IN
                    ('email_sha256','phone_e164_sha256','dl_au_state_sha256',
                     'medicare_sha256','passport_sha256','tfn_sha256',
                     'custom_sha256')),
  identifier_hash BYTEA NOT NULL,

  data_classes_present TEXT[] NOT NULL DEFAULT '{}',
  source_evidence TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (breach_id, identifier_type, identifier_hash)
);

CREATE INDEX IF NOT EXISTS idx_bvi_lookup
  ON breach_victims_index (identifier_type, identifier_hash);
CREATE INDEX IF NOT EXISTS idx_bvi_breach
  ON breach_victims_index (breach_id);

ALTER TABLE breach_victims_index ENABLE ROW LEVEL SECURITY;

-- ONLY the service role may directly read or write this table. Consumer
-- access goes through check_breach_exposure(...) below.
DROP POLICY IF EXISTS "Service role only on bvi" ON breach_victims_index;
CREATE POLICY "Service role only on bvi" ON breach_victims_index
  FOR ALL
  USING (auth.role() = 'service_role');

-- =============================================================================
-- 3. breach_sources_raw — ingest provenance for human review
-- =============================================================================
-- Scrapers (OAIC NDB, ransomware DLS, news, community reports) insert raw
-- captures here. Editors verify and link to a breach row before publishing.

CREATE TABLE IF NOT EXISTS breach_sources_raw (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  breach_id       BIGINT REFERENCES breaches(id) ON DELETE SET NULL,

  source_type     TEXT NOT NULL CHECK (source_type IN
                    ('ransomware_dls','oaic_ndb','news','editor',
                     'b2b_partner','community_report')),
  source_url      TEXT,
  source_actor    TEXT,
  raw_content     JSONB NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  is_verified     BOOLEAN DEFAULT false,
  verified_by     UUID REFERENCES auth.users(id),
  verified_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bsr_breach
  ON breach_sources_raw (breach_id);
CREATE INDEX IF NOT EXISTS idx_bsr_unverified
  ON breach_sources_raw (captured_at DESC)
  WHERE is_verified = false;

ALTER TABLE breach_sources_raw ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only on bsr" ON breach_sources_raw;
CREATE POLICY "Service role only on bsr" ON breach_sources_raw
  FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins read bsr" ON breach_sources_raw;
CREATE POLICY "Admins read bsr" ON breach_sources_raw
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- =============================================================================
-- 4. check_breach_exposure RPC — the only safe consumer-facing query path
-- =============================================================================
-- Returns rows from breach_victims_index joined to breaches, filtered to
-- published non-redacted breaches. Never returns the identifier_hash itself
-- so a caller cannot enumerate hashes. Rate-limited at the API layer (see
-- packages/utils/src/rate-limit.ts → checkBreachDefenceRateLimit, bd_lookup
-- bucket: 5/hr/IP).

CREATE OR REPLACE FUNCTION check_breach_exposure(
  p_identifier_type TEXT,
  p_identifier_hash BYTEA
)
RETURNS TABLE (
  breach_id        BIGINT,
  breach_slug      TEXT,
  entity_name      TEXT,
  disclosed_at     TIMESTAMPTZ,
  data_classes     TEXT[],
  au_doc_classes   TEXT[],
  threat_actor     TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    b.id,
    b.slug,
    b.entity_name,
    b.disclosed_at,
    COALESCE(NULLIF(bvi.data_classes_present, '{}'), b.data_classes) AS data_classes,
    b.au_doc_classes,
    b.threat_actor
  FROM breach_victims_index bvi
  JOIN breaches b ON b.id = bvi.breach_id
  WHERE bvi.identifier_type = p_identifier_type
    AND bvi.identifier_hash = p_identifier_hash
    AND b.is_published = true
    AND b.is_redacted = false
  ORDER BY b.disclosed_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION check_breach_exposure(TEXT, BYTEA) TO authenticated, anon;

COMMIT;
