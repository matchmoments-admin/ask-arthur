-- Migration v85: PFRA member registry — local mirror.
--
-- Why: the Public Fundraising Regulatory Association maintains a public
-- list of member charities (~50) and member fundraising agencies (~15)
-- at pfra.org.au/membership/{charity,fundraising-agency}-members/. PFRA
-- membership is the strongest single signal that a face-to-face / door-
-- knock fundraiser is legitimate — every PFRA-aligned fundraiser carries
-- a numbered ID badge, and members agree to the PFRA Standard for
-- conduct. v0.2c of the charity-check feature adds this as the 4th
-- pillar of the verdict screen.
--
-- Population: pipeline/scrapers/pfra_members.py runs weekly (PFRA
-- membership turns over ~once a quarter), parses the two HTML pages,
-- and upserts here. ABN is left NULL for now; a later pass joins
-- against acnc_charities on charity_legal_name to populate it where
-- possible.
--
-- RLS: public read (the source data is public on pfra.org.au), service-
-- role-only writes.
--
-- Idempotent: re-running adds nothing new.

CREATE TABLE IF NOT EXISTS pfra_members (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,         -- as scraped from pfra.org.au
  name_normalized TEXT NOT NULL,         -- lowercase, stopwords + punctuation stripped — used for joining
  member_type     TEXT NOT NULL CHECK (member_type IN ('charity', 'agency')),
  abn             TEXT,                  -- joined from acnc_charities best-effort
  source_url      TEXT NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, member_type)
);

CREATE INDEX IF NOT EXISTS idx_pfra_members_name_normalized
  ON pfra_members (name_normalized);
CREATE INDEX IF NOT EXISTS idx_pfra_members_abn
  ON pfra_members (abn) WHERE abn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pfra_members_member_type
  ON pfra_members (member_type);

ALTER TABLE pfra_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read pfra_members" ON pfra_members;
CREATE POLICY "Public read pfra_members" ON pfra_members
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role write pfra_members" ON pfra_members;
CREATE POLICY "Service role write pfra_members" ON pfra_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Lookup function. Either ABN or name (will be normalized inside).
-- Returns at most one row per member_type. The route can use this for
-- a single round-trip from the engine.
CREATE OR REPLACE FUNCTION lookup_pfra_member(
  p_abn TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL
) RETURNS TABLE (
  name TEXT,
  member_type TEXT,
  abn TEXT,
  source_url TEXT
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH normalized AS (
    SELECT
      LOWER(REGEXP_REPLACE(TRIM(COALESCE(p_name, '')), '[^a-z0-9 ]+', '', 'gi')) AS qname
  )
  SELECT m.name, m.member_type, m.abn, m.source_url
  FROM pfra_members m, normalized n
  WHERE
    (p_abn IS NOT NULL AND m.abn = p_abn)
    OR (p_name IS NOT NULL AND n.qname <> '' AND m.name_normalized = n.qname)
  ORDER BY (m.abn IS NOT NULL) DESC, m.member_type
  LIMIT 5;
$$;

REVOKE ALL ON FUNCTION lookup_pfra_member(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_pfra_member(TEXT, TEXT) TO anon, authenticated, service_role;

-- Join PFRA member rows to ACNC ABNs by exact-or-normalized name match.
-- Run by the scraper after each successful pull so the abn column stays
-- populated. Idempotent — only updates rows where the new abn differs.
CREATE OR REPLACE FUNCTION backfill_pfra_member_abns()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  WITH matches AS (
    SELECT
      m.id,
      c.abn AS candidate_abn
    FROM pfra_members m
    JOIN acnc_charities c
      ON LOWER(REGEXP_REPLACE(c.charity_legal_name, '[^a-z0-9 ]+', '', 'gi')) = m.name_normalized
    WHERE m.member_type = 'charity'
      AND (m.abn IS NULL OR m.abn IS DISTINCT FROM c.abn)
  )
  UPDATE pfra_members m
     SET abn = matches.candidate_abn,
         updated_at = NOW()
    FROM matches
   WHERE m.id = matches.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION backfill_pfra_member_abns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backfill_pfra_member_abns() TO service_role;

COMMENT ON TABLE pfra_members IS
  'Local mirror of pfra.org.au/membership/{charity,fundraising-agency}-members/. Refreshed weekly. ABN populated by backfill_pfra_member_abns() after each scrape (best-effort name join against acnc_charities).';

COMMENT ON FUNCTION lookup_pfra_member(TEXT, TEXT) IS
  'PFRA membership lookup by ABN (preferred) or name (normalized). Used by the charity-check engine 4th pillar.';
