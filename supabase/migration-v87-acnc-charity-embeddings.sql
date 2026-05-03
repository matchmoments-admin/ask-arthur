-- v87: semantic name+mission embeddings on acnc_charities for typosquat /
-- impersonation detection.
--
-- WHY: the existing acnc provider (packages/charity-check/src/providers/acnc.ts)
-- runs a trigram+Levenshtein hybrid that catches lexical typosquats well
-- ("Astralian Red Cross" → "Australian Red Cross") but misses semantic
-- impersonators where the surface forms diverge:
--
--   * "Save Australian Children"  vs  "Save the Children Australia"
--   * "AU Bushfire Relief Fund"   vs  "Australian Bushfire Relief Foundation"
--   * "Cancer Foundation AU"      vs  "Cancer Council Australia"
--
-- These have low trigram similarity but high cosine similarity on
-- voyage-3.5 — the kind of impersonator that survives until a victim has
-- already donated. We add semantic retrieval as a third signal alongside
-- the existing trigram/Levenshtein hybrid (NOT a replacement — they catch
-- different failure modes).
--
-- HNSW vs IVFFlat: this table is read-heavy (every name-only charity check
-- queries it), grows slowly (~daily delta from the ACNC scraper), and
-- consumers want top-1/top-5 recall to dominate. HNSW gives better recall
-- at small k than IVFFlat with comparable build time at this row count
-- (~64k). The reddit_intel_* tables stuck with IVFFlat because they were
-- larger at the time and IVFFlat's faster build mattered for nightly
-- re-clustering. See ADR-0005 (lands in Phase C) for the broader pgvector
-- index policy.
--
-- Embedding text strategy: composite of charity_legal_name + other_names
-- only. We deliberately exclude purposes/beneficiaries — those are similar
-- across genuinely-distinct charities (every cancer charity describes
-- "support for cancer patients") and dilute the name-discrimination signal.
-- Composite text is bounded to <= 512 chars so a single charity always
-- fits in one Voyage call.
--
-- Per ADR-0003: every embedding-bearing column gets a sibling
-- embedding_model_version TEXT column written from EmbedResult.modelId.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and
-- CREATE OR REPLACE FUNCTION make this safe to re-apply.

-- ---------------------------------------------------------------------------
-- 1. Embedding column + version sibling
-- ---------------------------------------------------------------------------

ALTER TABLE acnc_charities
  ADD COLUMN IF NOT EXISTS name_mission_embedding VECTOR(1024);

ALTER TABLE acnc_charities
  ADD COLUMN IF NOT EXISTS embedding_model_version TEXT;

COMMENT ON COLUMN acnc_charities.name_mission_embedding IS
  'voyage-3.5 (or successor — see embedding_model_version) 1024-dim '
  'embedding of charity_legal_name + other_names. Used for semantic '
  'typosquat detection that catches impersonators trigram misses. '
  'NULL until backfilled / for charities added since the last delta-embed run.';

COMMENT ON COLUMN acnc_charities.embedding_model_version IS
  'The embedding model id that produced name_mission_embedding (e.g. '
  '''voyage-3.5''). NULL only for rows whose embedding was never computed. '
  'See docs/adr/0003-embedding-model-versioning.md.';

-- ---------------------------------------------------------------------------
-- 2. HNSW index — partial, only over rows with an embedding present
-- ---------------------------------------------------------------------------

-- Defaults (m=16, ef_construction=64) are appropriate at 64k rows.
-- Query-side ef_search is set per-session by the RPC below so we don't
-- need a global tuning here.
CREATE INDEX IF NOT EXISTS idx_acnc_name_mission_embedding_hnsw
  ON acnc_charities USING hnsw (name_mission_embedding vector_cosine_ops)
  WHERE name_mission_embedding IS NOT NULL;

-- Version-column index for the reindex policy in ADR-0003 (filter rows
-- whose model is older than the current default).
CREATE INDEX IF NOT EXISTS idx_acnc_embedding_model_version
  ON acnc_charities (embedding_model_version)
  WHERE name_mission_embedding IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RPC: match_charities_by_embedding
-- ---------------------------------------------------------------------------

-- Vector-similarity nearest-neighbour over acnc_charities. Returns charities
-- whose cosine similarity to the query embedding is >= p_min_similarity,
-- ordered by similarity DESC. Caller owns thresholding above the floor (the
-- floor here is just to avoid returning unrelated results).
--
-- ef_search is bumped from the default 40 to 80 — at 64k rows the
-- recall@10 difference is meaningful (~0.92 -> 0.98) and the latency
-- delta is sub-millisecond. Tunable per-session if needed.
CREATE OR REPLACE FUNCTION match_charities_by_embedding(
  p_query_embedding VECTOR(1024),
  p_match_count     INT  DEFAULT 5,
  p_min_similarity  REAL DEFAULT 0.55
) RETURNS TABLE (
  abn                 TEXT,
  charity_legal_name  TEXT,
  charity_website     TEXT,
  town_city           TEXT,
  state               TEXT,
  similarity          REAL
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM set_config('hnsw.ef_search', '80', true);

  RETURN QUERY
  SELECT
    c.abn,
    c.charity_legal_name,
    c.charity_website,
    c.town_city,
    c.state,
    (1 - (c.name_mission_embedding <=> p_query_embedding))::REAL AS similarity
  FROM acnc_charities c
  WHERE c.name_mission_embedding IS NOT NULL
    AND (1 - (c.name_mission_embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY c.name_mission_embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$$;

REVOKE ALL ON FUNCTION match_charities_by_embedding(VECTOR(1024), INT, REAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_charities_by_embedding(VECTOR(1024), INT, REAL)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION match_charities_by_embedding(VECTOR(1024), INT, REAL) IS
  'Cosine-similarity NN over acnc_charities.name_mission_embedding. Caller '
  'should embed the query with embedQuery(_, { domain: "generic" }) so the '
  'asymmetric Voyage prompt aligns with how documents were embedded.';
