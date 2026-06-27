-- v188 — fix match_themes_by_centroid: pgvector moved to the `extensions`
-- schema, so `SET search_path = public, pg_catalog` (v96a/v96b/v186) can no
-- longer resolve the `<=>` cosine-distance operator INSIDE the function:
--
--   ERROR 42883: operator does not exist: extensions.vector <=> extensions.vector
--
-- v96a originally fixed an empty-search_path version of this bug when pgvector
-- lived in `public`; pgvector has since been relocated to `extensions` (the
-- Supabase default), re-breaking operator resolution. A function's own
-- `SET search_path` overrides the caller's, so the only fix is to add
-- `extensions` to the function definition. Symptom: getRelevantThemes
-- (packages/scam-engine/src/retrieval/themes.ts) swallows the RPC error and
-- returns [] → RAG themes silently never reach the analyze prompt. This makes
-- the whole FF_RAG_THEMES feature (and the v186 tactic_tags addition) actually
-- function.
--
-- Identical body to v186 (incl. top_tactic_tags) — only the search_path changes
-- (public, pg_catalog → public, extensions, pg_catalog). Idempotent CREATE OR
-- REPLACE (return type unchanged from v186, so no DROP needed).
--
-- NOTE (follow-up): other SECURITY INVOKER pgvector RPCs created with
-- `public, pg_catalog` (e.g. match_reddit_intel, match_charities_by_embedding)
-- likely have the same latent break — audit + fix separately.

CREATE OR REPLACE FUNCTION match_themes_by_centroid(
  p_query_embedding VECTOR(1024),
  p_match_count INT DEFAULT 3,
  p_min_similarity FLOAT DEFAULT 0.45,
  p_min_signal_strength TEXT DEFAULT 'weak'
)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  title TEXT,
  narrative TEXT,
  modus_operandi TEXT,
  representative_brands TEXT[],
  top_tactic_tags TEXT[],
  signal_strength TEXT,
  member_count INTEGER,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_strength_rank INT;
BEGIN
  v_strength_rank := CASE p_min_signal_strength
    WHEN 'noise' THEN 0
    WHEN 'weak'  THEN 1
    WHEN 'strong' THEN 2
    ELSE 1
  END;

  RETURN QUERY
  SELECT
    t.id,
    t.slug,
    t.title,
    t.narrative,
    t.modus_operandi,
    t.representative_brands,
    t.top_tactic_tags,
    t.signal_strength,
    t.member_count,
    (1 - (t.centroid_embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.reddit_intel_themes AS t
  WHERE t.is_active = TRUE
    AND t.centroid_embedding IS NOT NULL
    AND t.title != 'Pending naming'
    AND CASE t.signal_strength
          WHEN 'noise' THEN 0
          WHEN 'weak'  THEN 1
          WHEN 'strong' THEN 2
          ELSE 0
        END >= v_strength_rank
    AND (1 - (t.centroid_embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY t.centroid_embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$$;
