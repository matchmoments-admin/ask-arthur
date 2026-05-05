-- v96b — exclude themes still pending naming from RAG retrieval.
--
-- /api/analyze/similar (W1.2) and /api/analyze with FF_RAG_THEMES (PR #132)
-- both inject the top-K returned themes into Haiku's prompt as "RECENT
-- AUSTRALIAN SCAM PATTERNS". The reddit-intel-cluster Inngest function
-- only names themes once they cross member_count >= 3
-- (MIN_MEMBERS_FOR_NAMING in
-- packages/scam-engine/src/inngest/reddit-intel-cluster.ts:54), so any
-- new singleton or pair carries title='Pending naming' for some time.
--
-- As of 2026-05-06, 145 of 160 active themes were stuck at 'Pending
-- naming' (133 singletons + 12 pairs), making the RAG block render as:
--   - "Pending naming": …
--   - "Pending naming": …
-- — useless context for Haiku, actively worse than no RAG at all because
-- the prompt now has noise where signal should live.
--
-- Filtering at the RPC is the right seam: themes without a real title
-- carry no usable signal regardless of cosine similarity to the query.
-- Self-healing — when a cluster legitimately accumulates 3+ members and
-- the cron names it, it becomes eligible for RAG injection automatically;
-- no further migration needed.
--
-- Trade-off: until cluster volume catches up, RAG coverage is the
-- intersection of (named themes) and (themes whose centroid matches
-- the user's submission). At 15 named themes today this is sparse.
-- The alternative — keeping noisy "Pending naming" in the prompt — is
-- worse for Haiku's output quality. Tracked alongside the threshold
-- tuning work on BACKLOG.md → Reddit Scam Intelligence priority watch.
--
-- Already applied to prod 2026-05-06 via mcp__supabase__apply_migration
-- under the name `match_themes_skip_pending_naming`. Idempotent
-- CREATE OR REPLACE FUNCTION; safe to re-run.

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
