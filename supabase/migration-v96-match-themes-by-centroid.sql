-- Migration v96 — match_themes_by_centroid RPC
--
-- Round-2 audit (f) closure. Surfaces the top-K Reddit-intel themes whose
-- cluster centroid is most similar to a given query embedding. Used by
-- /api/analyze (gated on FF_RAG_THEMES) to inject "what scams the
-- community is currently seeing" into the Haiku system prompt before
-- classification, so Haiku can name themes by their canonical slug
-- instead of guessing.
--
-- Why a separate RPC vs inline SQL: callers in TS-land hit this via
-- supabase.rpc() so query plans stay consistent and the
-- security_invoker / SET search_path posture is auditable in one place.
-- Same pattern as match_scam_reports_hybrid (v95).
--
-- Inputs:
--   p_query_embedding   — 1024-dim Voyage 3.5 query vector (asymmetric
--                         input_type=query side; centroids were embedded
--                         document-side so cosine works correctly).
--   p_match_count       — top-K to return after filtering. Default 3 —
--                         the Haiku prompt becomes noisy beyond that.
--   p_min_similarity    — drop themes below this dense-cosine sim.
--                         Default 0.45 — mid-recall, low-precision
--                         filter; the rerank-2.5-lite reranker step
--                         tightens precision in the caller.
--   p_min_signal_strength — only return themes at this strength or
--                         stronger. Default 'weak' (excludes 'noise').
--                         Use 'strong' if you want stricter filtering.
--
-- Returns one row per matched theme with the fields the Haiku prompt
-- needs (slug, title, narrative, modus_operandi, representative_brands,
-- member_count) plus the cosine similarity for telemetry / threshold
-- tuning.
--
-- Security: SECURITY INVOKER + SET search_path = '' so policies on the
-- caller's role apply. The themes table has no RLS today — all
-- consumer surfaces use the service-role client — but the search_path
-- guard is required by Supabase advisor RULE F0006.

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
SET search_path = ''
AS $$
DECLARE
  v_strength_rank INT;
BEGIN
  -- Map the requested minimum signal strength into an ordinal so we can
  -- filter with a simple >= comparison. Match the CHECK constraint on
  -- reddit_intel_themes.signal_strength: 'noise' (0) < 'weak' (1) < 'strong' (2).
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

GRANT EXECUTE ON FUNCTION match_themes_by_centroid(VECTOR(1024), INT, FLOAT, TEXT) TO service_role;

COMMENT ON FUNCTION match_themes_by_centroid IS
  'Round-2 audit (f) — top-K Reddit-intel themes by centroid cosine similarity. ' ||
  'Used by /api/analyze for FF_RAG_THEMES prompt injection.';
