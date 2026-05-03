-- v88: server-side ANN RPCs for Reddit Intel — match_reddit_intel and
-- match_reddit_intel_themes.
--
-- WHY: the existing reddit_post_intel.embedding column has had an IVFFlat
-- index since v82 but no production query path uses it. The cluster job
-- pulls 500 rows and runs cosine in JS (packages/scam-engine/src/inngest/
-- reddit-intel-cluster.ts) which doesn't scale past the current cohort
-- size, and the new B2B `/api/v1/intel/search` endpoint needs a
-- proper Postgres-side ANN query with a similarity floor.
--
-- These RPCs are the canonical query path:
--   * match_reddit_intel(query_emb, count, min_sim) — over individual posts
--   * match_reddit_intel_themes(query_emb, count, min_sim) — over cluster
--     centroids
--
-- Both use the existing IVFFlat index. ivfflat.probes is bumped from the
-- default 1 to 10 inside the function — at lists=100 (per v82) probes=10
-- gives recall @10 ~0.95+ at sub-ms latency vs ~0.70 with the default. The
-- session-local SET via set_config doesn't leak to other queries.
--
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION makes this safe to re-apply.
-- No table changes — purely additive.

CREATE OR REPLACE FUNCTION match_reddit_intel(
  p_query_embedding   VECTOR(1024),
  p_match_count       INT  DEFAULT 50,
  p_min_similarity    REAL DEFAULT 0.55
) RETURNS TABLE (
  id                  UUID,
  feed_item_id        BIGINT,
  intent_label        TEXT,
  brands_impersonated TEXT[],
  narrative_summary   TEXT,
  modus_operandi      TEXT,
  processed_at        TIMESTAMPTZ,
  similarity          REAL
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM set_config('ivfflat.probes', '10', true);

  RETURN QUERY
  SELECT
    p.id,
    p.feed_item_id,
    p.intent_label,
    p.brands_impersonated,
    p.narrative_summary,
    p.modus_operandi,
    p.processed_at,
    (1 - (p.embedding <=> p_query_embedding))::REAL AS similarity
  FROM reddit_post_intel p
  WHERE p.embedding IS NOT NULL
    AND (1 - (p.embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY p.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$$;

REVOKE ALL ON FUNCTION match_reddit_intel(VECTOR(1024), INT, REAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_reddit_intel(VECTOR(1024), INT, REAL)
  TO authenticated, service_role;

COMMENT ON FUNCTION match_reddit_intel(VECTOR(1024), INT, REAL) IS
  'Cosine NN over reddit_post_intel.embedding. Caller should embed the '
  'query with embedQuery(_, { domain: "generic" }) so the asymmetric '
  'Voyage prompt aligns with how documents were embedded. Returns '
  'unfiltered top-N for the caller to feed into a reranker.';

CREATE OR REPLACE FUNCTION match_reddit_intel_themes(
  p_query_embedding   VECTOR(1024),
  p_match_count       INT  DEFAULT 20,
  p_min_similarity    REAL DEFAULT 0.55
) RETURNS TABLE (
  id                  UUID,
  slug                TEXT,
  title               TEXT,
  description         TEXT,
  member_count        INTEGER,
  ioc_url_count       INTEGER,
  ioc_phone_count     INTEGER,
  similarity          REAL
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM set_config('ivfflat.probes', '10', true);

  RETURN QUERY
  SELECT
    t.id,
    t.slug,
    t.title,
    t.description,
    t.member_count,
    t.ioc_url_count,
    t.ioc_phone_count,
    (1 - (t.centroid_embedding <=> p_query_embedding))::REAL AS similarity
  FROM reddit_intel_themes t
  WHERE t.centroid_embedding IS NOT NULL
    AND (1 - (t.centroid_embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY t.centroid_embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$$;

REVOKE ALL ON FUNCTION match_reddit_intel_themes(VECTOR(1024), INT, REAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_reddit_intel_themes(VECTOR(1024), INT, REAL)
  TO authenticated, service_role;

COMMENT ON FUNCTION match_reddit_intel_themes(VECTOR(1024), INT, REAL) IS
  'Cosine NN over reddit_intel_themes.centroid_embedding. For B2B clients '
  'looking up a scam-narrative cluster head rather than individual posts.';
