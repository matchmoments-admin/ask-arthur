-- v89: voyage-3.5 (or voyage-finance-2) embeddings on scam_reports and
-- verified_scams + match RPCs.
--
-- WHY: scam_reports is the central node for every consumer-submitted
-- analysis (23 rows today, growing as adoption ramps). The "12 people
-- reported similar in the last 30 days" panel and the future B2B
-- /api/v1/scams/search endpoint both need a fast cosine NN over the
-- corpus, partitioned by scam_type / verdict / time window. verified_scams
-- gets the same treatment so high-confidence verified incidents
-- participate in retrieval as authoritative anchors.
--
-- HNSW (not IVFFlat) for both:
--   * scam_reports growth rate is unbounded — once consumer adoption
--     ramps these tables become the hottest cosine-query targets in the
--     system. HNSW gives better recall at small k as rows grow vs
--     IVFFlat with a fixed lists count.
--   * Read-heavy query pattern (one cosine query per /api/scan flow,
--     every B2B call) — index build cost is amortised easily.
--   * Both indexes are PARTIAL `WHERE embedding IS NOT NULL` so the
--     transition from "0 rows embedded" to "fully backfilled" doesn't
--     require an index recreate. ADR-0005 covers the broader policy.
--
-- Per ADR-0003: every embedding-bearing column gets a sibling
-- embedding_model_version TEXT column written from EmbedResult.modelId.
--
-- Domain routing (via the analyze pipeline, not in this migration):
--   * scam_type IN ('investment', 'crypto', 'bec', 'invoice') → finance
--   * everything else → generic
-- The voyage-finance-2 model returns 1024-dim natively (no Matryoshka),
-- voyage-3.5 returns 1024-dim via output_dimension. The pgvector column
-- type is the same for both, so the version column distinguishes them
-- per ADR-0003 and the reindex policy applies on model swaps.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION make this safe to re-apply.

-- ---------------------------------------------------------------------------
-- 1. scam_reports — embedding + version sibling
-- ---------------------------------------------------------------------------

ALTER TABLE scam_reports
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1024);

ALTER TABLE scam_reports
  ADD COLUMN IF NOT EXISTS embedding_model_version TEXT;

COMMENT ON COLUMN scam_reports.embedding IS
  'voyage-3.5 (generic) or voyage-finance-2 (finance domain) 1024-dim '
  'embedding of scrubbed_content + structured signals (scam_type, '
  'channel, impersonated_brand). NULL for SAFE verdicts and reports '
  'shorter than 40 chars (no useful retrieval signal). See '
  'embedding_model_version for which model produced it.';

COMMENT ON COLUMN scam_reports.embedding_model_version IS
  'The embedding model id that produced embedding (e.g. ''voyage-3.5'' '
  'or ''voyage-finance-2''). NULL only for rows whose embedding was '
  'never computed. See docs/adr/0003-embedding-model-versioning.md.';

CREATE INDEX IF NOT EXISTS idx_scam_reports_embedding_hnsw
  ON scam_reports USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scam_reports_embedding_model_version
  ON scam_reports (embedding_model_version)
  WHERE embedding IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. verified_scams — embedding + version sibling
-- ---------------------------------------------------------------------------

ALTER TABLE verified_scams
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1024);

ALTER TABLE verified_scams
  ADD COLUMN IF NOT EXISTS embedding_model_version TEXT;

COMMENT ON COLUMN verified_scams.embedding IS
  'voyage-3.5 (or voyage-finance-2 for finance scams) 1024-dim embedding '
  'of summary + scam_type + impersonated_brand. Authoritative anchors '
  'for retrieval — verified_scams rows are higher-confidence than '
  'individual user reports.';

COMMENT ON COLUMN verified_scams.embedding_model_version IS
  'Model id that produced embedding (per ADR-0003).';

CREATE INDEX IF NOT EXISTS idx_verified_scams_embedding_hnsw
  ON verified_scams USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verified_scams_embedding_model_version
  ON verified_scams (embedding_model_version)
  WHERE embedding IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RPC: match_scam_reports
-- ---------------------------------------------------------------------------

-- Time-windowed cosine NN over scam_reports.embedding. Drops SAFE
-- verdicts from the result set (they don't carry useful "this is the
-- scam pattern you're seeing" signal) and filters by recency window.
-- ef_search bumped to 80 for recall@10 ~0.92→~0.98.
CREATE OR REPLACE FUNCTION match_scam_reports(
  p_query_embedding   VECTOR(1024),
  p_match_count       INT  DEFAULT 25,
  p_min_similarity    REAL DEFAULT 0.55,
  p_since_days        INT  DEFAULT 30
) RETURNS TABLE (
  id                  BIGINT,
  scam_type           TEXT,
  verdict             TEXT,
  confidence_score    REAL,
  impersonated_brand  TEXT,
  channel             TEXT,
  region              TEXT,
  scrubbed_content    TEXT,
  created_at          TIMESTAMPTZ,
  similarity          REAL
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM set_config('hnsw.ef_search', '80', true);

  RETURN QUERY
  SELECT
    r.id,
    r.scam_type,
    r.verdict,
    r.confidence_score,
    r.impersonated_brand,
    r.channel,
    r.region,
    r.scrubbed_content,
    r.created_at,
    (1 - (r.embedding <=> p_query_embedding))::REAL AS similarity
  FROM scam_reports r
  WHERE r.embedding IS NOT NULL
    AND r.verdict != 'SAFE'
    AND r.created_at >= NOW() - (p_since_days || ' days')::INTERVAL
    AND (1 - (r.embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY r.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$$;

REVOKE ALL ON FUNCTION match_scam_reports(VECTOR(1024), INT, REAL, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_scam_reports(VECTOR(1024), INT, REAL, INT)
  TO authenticated, service_role;

COMMENT ON FUNCTION match_scam_reports(VECTOR(1024), INT, REAL, INT) IS
  'Recency-windowed cosine NN over scam_reports.embedding, excluding '
  'SAFE verdicts. Caller should embed the query with embedQuery(). '
  'Returns unfiltered top-N for the caller to feed into a reranker.';

-- ---------------------------------------------------------------------------
-- 4. RPC: match_verified_scams
-- ---------------------------------------------------------------------------

-- No recency filter on verified_scams — these are authoritative anchors
-- and a 6-month-old verified scam pattern is still a high-confidence
-- match if the cosine fits. The UI/API caller can apply a time filter
-- post-hoc if it wants recency.
CREATE OR REPLACE FUNCTION match_verified_scams(
  p_query_embedding   VECTOR(1024),
  p_match_count       INT  DEFAULT 10,
  p_min_similarity    REAL DEFAULT 0.55
) RETURNS TABLE (
  id                  BIGINT,
  scam_type           TEXT,
  channel             TEXT,
  summary             TEXT,
  impersonated_brand  TEXT,
  region              TEXT,
  confidence_score    REAL,
  created_at          TIMESTAMPTZ,
  similarity          REAL
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM set_config('hnsw.ef_search', '80', true);

  RETURN QUERY
  SELECT
    v.id,
    v.scam_type,
    v.channel,
    v.summary,
    v.impersonated_brand,
    v.region,
    v.confidence_score,
    v.created_at,
    (1 - (v.embedding <=> p_query_embedding))::REAL AS similarity
  FROM verified_scams v
  WHERE v.embedding IS NOT NULL
    AND (1 - (v.embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY v.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$$;

REVOKE ALL ON FUNCTION match_verified_scams(VECTOR(1024), INT, REAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_verified_scams(VECTOR(1024), INT, REAL)
  TO authenticated, service_role;

COMMENT ON FUNCTION match_verified_scams(VECTOR(1024), INT, REAL) IS
  'Cosine NN over verified_scams.embedding (no recency filter — verified '
  'rows are durable anchors). Caller embeds query, calls this, optionally '
  'reranks.';
