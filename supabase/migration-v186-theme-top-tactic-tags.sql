-- v186 — surface aggregated tactic tags on reddit_intel_themes for RAG.
--
-- reddit_post_intel.tactic_tags[] (urgency_window, authority_appeal, …) is
-- extracted per-post by the classifier but was WRITE-ONLY — nothing read it.
-- Tactics are the most transferable scam signal across brand/channel
-- variation, so they belong in the RAG prompt that match_themes_by_centroid
-- feeds into /api/analyze. We aggregate the top tactics per theme (computed in
-- reddit-intel-cluster.ts when a theme is named) into a new column, and return
-- it from the matcher so renderThemesForPrompt can append a "Common tactics:"
-- line.
--
-- Two parts, both idempotent:
--   1. ADD COLUMN top_tactic_tags TEXT[] (nullable; populated on next naming).
--   2. CREATE OR REPLACE match_themes_by_centroid to return the new column.
--      Based on the LIVE v96b body (pending-naming skip) — preserves the
--      `SET search_path = public, pg_catalog` posture (NOT '' — the empty form
--      hides pgvector's `<=>` operator; that exact bug is what v96a fixed) and
--      the `#variable_conflict use_column` guard.

ALTER TABLE public.reddit_intel_themes
  ADD COLUMN IF NOT EXISTS top_tactic_tags TEXT[];

-- Adding a column to RETURNS TABLE changes the function's return type, which
-- CREATE OR REPLACE cannot do — must DROP first. getRelevantThemes catches any
-- RPC error → [] (never throws), so the brief drop/recreate window degrades RAG
-- to "no themes", never an analyze failure.
DROP FUNCTION IF EXISTS match_themes_by_centroid(vector, integer, double precision, text);

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
