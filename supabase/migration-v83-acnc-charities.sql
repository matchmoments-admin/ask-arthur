-- Migration v83: ACNC Charity Register — local Postgres mirror.
--
-- Why: enables sub-100ms autocomplete + offline lookup in the upcoming
-- /charity-check feature without per-keystroke calls to data.gov.au CKAN.
-- ABN is the natural key. The CKAN dataset (resource id
-- eb1e6be4-5b13-4feb-b28e-388bf7c26f93, ~64k rows, weekly refresh) is
-- mirrored by pipeline/scrapers/acnc_register.py.
--
-- Notable scope decision: DGR endorsement and AIS lodgement currency are NOT
-- in this CKAN resource — DGR comes from the live ABR Lookup wrapper at
-- apps/web/lib/abnLookup.ts (Redis-cached), and AIS currency is its own
-- annual dataset best ingested in a follow-up. Keeping this table to the
-- "core register" fields avoids storing data we can't keep fresh.
--
-- RLS: public read (this register is public information surfaced in the
-- consumer UI autocomplete), service-role-only writes.
--
-- Idempotent: re-running adds nothing new.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS acnc_charities (
  abn                         TEXT PRIMARY KEY,
  charity_legal_name          TEXT NOT NULL,
  other_names                 TEXT[] NOT NULL DEFAULT '{}',
  charity_website             TEXT,

  address_line_1              TEXT,
  address_line_2              TEXT,
  address_line_3              TEXT,
  town_city                   TEXT,
  state                       TEXT,
  postcode                    TEXT,
  country                     TEXT,

  charity_size                TEXT,         -- Small | Medium | Large | NULL
  registration_date           DATE,
  date_established            DATE,
  number_responsible_persons  INTEGER,
  financial_year_end          TEXT,         -- e.g. '30-Jun'
  operates_in_states          TEXT[] NOT NULL DEFAULT '{}',
  operating_countries         TEXT,

  is_pbi                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Public Benevolent Institution
  is_hpc                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Health Promotion Charity

  purposes                    TEXT[] NOT NULL DEFAULT '{}',
  beneficiaries               TEXT[] NOT NULL DEFAULT '{}',

  source_resource_id          TEXT NOT NULL,
  source_row_hash             TEXT NOT NULL,
  ingested_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigram index for autocomplete + fuzzy match. Used by search_charities().
CREATE INDEX IF NOT EXISTS idx_acnc_charities_legal_name_trgm
  ON acnc_charities USING gin (charity_legal_name gin_trgm_ops);

-- Other-names GIN so trading-name matches surface as well as legal name.
CREATE INDEX IF NOT EXISTS idx_acnc_charities_other_names_gin
  ON acnc_charities USING gin (other_names);

CREATE INDEX IF NOT EXISTS idx_acnc_charities_state
  ON acnc_charities (state) WHERE state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acnc_charities_town_state
  ON acnc_charities (town_city, state);

ALTER TABLE acnc_charities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read acnc_charities" ON acnc_charities;
CREATE POLICY "Public read acnc_charities" ON acnc_charities
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role write acnc_charities" ON acnc_charities;
CREATE POLICY "Service role write acnc_charities" ON acnc_charities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Autocomplete + name lookup. Used by /api/charity-check/autocomplete.
-- Exposed via PostgREST as /rest/v1/rpc/search_charities.
--
-- Ranking: ILIKE-prefix matches dominate (similarity 1.0), then trigram
-- similarity. Town+state are returned so the UI can disambiguate the
-- many "Children's Foundation"-style collisions in the register.
CREATE OR REPLACE FUNCTION search_charities(
  p_query TEXT,
  p_limit INT DEFAULT 8
) RETURNS TABLE (
  abn                 TEXT,
  charity_legal_name  TEXT,
  town_city           TEXT,
  state               TEXT,
  charity_website     TEXT,
  similarity_score    REAL
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    abn,
    charity_legal_name,
    town_city,
    state,
    charity_website,
    GREATEST(
      similarity(charity_legal_name, p_query),
      CASE WHEN charity_legal_name ILIKE p_query || '%' THEN 1.0 ELSE 0.0 END
    )::REAL AS similarity_score
  FROM acnc_charities
  WHERE charity_legal_name ILIKE p_query || '%'
     OR charity_legal_name % p_query
  ORDER BY similarity_score DESC, charity_legal_name ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION search_charities(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_charities(TEXT, INT) TO anon, authenticated, service_role;

COMMENT ON TABLE acnc_charities IS
  'Local mirror of the ACNC Charity Register (CKAN resource eb1e6be4-5b13-4feb-b28e-388bf7c26f93). Refreshed daily by pipeline/scrapers/acnc_register.py with skip-on-no-change row-hashing. ABN is the natural key; DGR endorsement is fetched live from ABR Lookup, AIS currency lives in a separate dataset.';

COMMENT ON FUNCTION search_charities(TEXT, INT) IS
  'Charity-name autocomplete for /charity-check. ILIKE-prefix wins over trigram; returns town+state for disambiguation.';
