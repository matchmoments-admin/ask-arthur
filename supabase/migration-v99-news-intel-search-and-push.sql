-- v99 — News-intel narrative search RPC + regulator push dedup.
--
-- 1. match_feed_items_narrative — dense-only ANN over feed_items.embedding for
--    regulator narratives. Mirrors match_reddit_intel's contract so the
--    /api/v1/intel/search route can merge results without two adapters.
--
--    Why dense-only (no BM25 hybrid like match_scam_reports_hybrid): at <1k
--    narratives/year volume the vector search is already exhaustive, BM25
--    adds query latency without lift. Re-evaluate if narrative volume
--    crosses ~10k.
--
--    SET search_path = public, pg_catalog because pgvector's <=> operator
--    lives in the vector extension; an empty search_path hides it (caught in
--    a prior migration — see CLAUDE.md operator-resolution note).
--
-- 2. regulator_alert_pushes — primary key on feed_item_id is the dedup key
--    for the */30-min push cron. No FK to feed_items so archived narratives
--    don't trigger CASCADE deletes that would make replay deterministic
--    impossible (e.g., for incident audit).

CREATE OR REPLACE FUNCTION public.match_feed_items_narrative(
  p_query_embedding vector(1024),
  p_match_count INT DEFAULT 20,
  p_min_similarity REAL DEFAULT 0.55,
  p_since_days INT DEFAULT 90
) RETURNS TABLE (
  id BIGINT,
  source TEXT,
  title TEXT,
  description TEXT,
  body_md TEXT,
  url TEXT,
  category TEXT,
  impersonated_brand TEXT,
  tags TEXT[],
  published_at TIMESTAMPTZ,
  similarity REAL
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    fi.id,
    fi.source,
    fi.title,
    fi.description,
    LEFT(fi.body_md, 2000) AS body_md,
    fi.url,
    fi.category,
    fi.impersonated_brand,
    fi.tags,
    fi.published_at,
    (1 - (fi.embedding <=> p_query_embedding))::real AS similarity
  FROM public.feed_items fi
  WHERE fi.embedding IS NOT NULL
    AND fi.source IN ('scamwatch_alert', 'acsc', 'asic_investor')
    AND (p_since_days IS NULL
         OR fi.published_at IS NULL
         OR fi.published_at >= NOW() - (p_since_days || ' days')::INTERVAL)
    AND (1 - (fi.embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY fi.embedding <=> p_query_embedding
  LIMIT GREATEST(1, LEAST(p_match_count, 100));
$$;

REVOKE ALL ON FUNCTION public.match_feed_items_narrative(vector, INT, REAL, INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_feed_items_narrative(vector, INT, REAL, INT) TO service_role;

COMMENT ON FUNCTION public.match_feed_items_narrative(vector, INT, REAL, INT) IS
  'Dense ANN over feed_items.embedding for regulator narratives (Scamwatch/ACSC/ASIC). Mirrors match_reddit_intel contract for the /api/v1/intel/search merger.';

-- ── 2. regulator_alert_pushes — push dedup table ──────────────────────────

CREATE TABLE IF NOT EXISTS public.regulator_alert_pushes (
  feed_item_id    BIGINT PRIMARY KEY,
  pushed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipient_count INT NOT NULL DEFAULT 0,
  error_count     INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_regulator_alert_pushes_pushed_at
  ON public.regulator_alert_pushes (pushed_at DESC);

ALTER TABLE public.regulator_alert_pushes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS regulator_alert_pushes_service ON public.regulator_alert_pushes;
CREATE POLICY regulator_alert_pushes_service ON public.regulator_alert_pushes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.regulator_alert_pushes IS
  'Dedup ledger for the regulator-alert-push Inngest cron. PK on feed_item_id ensures a second */30 tick can never re-push the same narrative.';
