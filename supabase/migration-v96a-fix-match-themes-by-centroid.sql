-- v96a — match_themes_by_centroid hotfix (search_path hides pgvector ops).
--
-- v96 originally shipped with `SET search_path = ''` — the safest posture
-- for SECURITY DEFINER functions where unqualified-name resolution is the
-- threat model. But this function is SECURITY INVOKER (caller's
-- privileges apply), AND it depends on pgvector's `<=>` cosine-distance
-- operator. pgvector installs into `public` by default, so an empty
-- search_path means PL/pgSQL can't resolve the operator at function-call
-- time:
--
--   ERROR 42883: operator does not exist: public.vector <=> public.vector
--   HINT: No operator matches the given name and argument types. You
--   might need to add explicit type casts.
--
-- The hint is misleading — both args ARE public.vector. The actual issue
-- is operator resolution under empty search_path.
--
-- Fix applied 2026-05-06 to prod via the
-- `fix_match_themes_by_centroid_search_path` migration:
--   1. SET search_path = public, pg_catalog (matches v95's posture)
--   2. Defensive #variable_conflict use_column (no current ambiguity but
--      free insurance against future edits — same precaution we now take
--      in v95a after the v95 id-ambiguity bite)
--
-- Idempotent — CREATE OR REPLACE. From-scratch apply pipeline runs v96
-- (broken) then v96a (fixed); the fix wins because the second one
-- overwrites the function body.

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
  signal_strength TEXT,
  member_count INTEGER,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
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
    t.signal_strength,
    t.member_count,
    (1 - (t.centroid_embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.reddit_intel_themes AS t
  WHERE t.is_active = TRUE
    AND t.centroid_embedding IS NOT NULL
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
