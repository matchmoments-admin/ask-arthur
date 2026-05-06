-- v98 — Retention/archive for news-intel feed surfaces.
--
-- Mirrors the v68 scam_reports_archive pattern:
--   * feed_items_archive  — cold-table copy of aged narrative rows
--   * archive_feed_items_batch() — bounded-batch mover
--   * feed_items_all view — union of hot+archive for fraud-team queries
--
-- Plus two simpler housekeepers (no archive, just prune):
--   * prune_feed_ingestion_log() — drops monitoring rows > 90d
--   * prune_feed_http_cache()    — drops unused ETag entries > 30d
--
-- Retention windows:
--   feed_items narrative rows  → 365d hot, then archived  (regulator alerts
--                                  retain forensic value far longer than
--                                  consumer-side reports, hence the longer
--                                  hot residency vs scam_reports' 90d)
--   feed_items reddit rows     → unchanged (reddit_processed_posts cleanup at 30d)
--   feed_ingestion_log         → 90d  (operational telemetry only)
--   feed_http_cache            → 30d  (ETag cache; stale entries 304-bypass anyway)
--
-- Idempotent: every CREATE uses IF NOT EXISTS / OR REPLACE.

-- ── 1. feed_items_archive — mirror schema ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.feed_items_archive (
  id                    BIGINT PRIMARY KEY,
  source                TEXT NOT NULL,
  external_id           TEXT,
  title                 TEXT NOT NULL,
  description           TEXT,
  url                   TEXT,
  source_url            TEXT,
  category              TEXT,
  channel               TEXT,
  r2_image_key          TEXT,
  reddit_image_url      TEXT,
  has_image             BOOLEAN,
  impersonated_brand    TEXT,
  country_code          TEXT,
  upvotes               INT,
  verified              BOOLEAN,
  published             BOOLEAN,
  source_created_at     TIMESTAMPTZ,
  body_md               TEXT,
  tags                  TEXT[],
  published_at          TIMESTAMPTZ,
  evidence_r2_key       TEXT,
  embedding_model_version TEXT,
  provenance_tier       provenance_tier_t,
  created_at            TIMESTAMPTZ NOT NULL,
  archived_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cold-storage tail doesn't need the embedding vector — drop it for size.
-- If we ever want to re-rank archived narratives we can rehydrate from body_md.

CREATE INDEX IF NOT EXISTS idx_feed_items_archive_source_published
  ON public.feed_items_archive (source, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_feed_items_archive_created
  ON public.feed_items_archive (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_archive_tags
  ON public.feed_items_archive USING GIN (tags);

ALTER TABLE public.feed_items_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feed_items_archive_service ON public.feed_items_archive;
CREATE POLICY feed_items_archive_service ON public.feed_items_archive
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. archive_feed_items_batch — bounded-batch mover ────────────────────
--
-- Two cutoffs:
--   regulator narratives (scamwatch_alert / acsc / asic_investor) → p_default_days
--   reddit / user_report / verified_scam                         → keep forever
--                                                                  (reddit has
--                                                                  its own dedup
--                                                                  cleanup; user
--                                                                  reports tie to
--                                                                  scam_reports)
-- Bounded batch keeps transactions short — cron re-invokes until moved=0.

CREATE OR REPLACE FUNCTION public.archive_feed_items_batch(
  p_batch_size INT DEFAULT 5000,
  p_default_days INT DEFAULT 365
)
RETURNS TABLE (moved_items INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids BIGINT[];
  v_moved INT := 0;
BEGIN
  -- Pick eligible ids up-front so INSERT/DELETE see the same set.
  SELECT array_agg(id)
    INTO v_ids
    FROM (
      SELECT id
        FROM public.feed_items
       WHERE source IN ('scamwatch_alert', 'acsc', 'asic_investor')
         AND created_at < NOW() - (p_default_days || ' days')::INTERVAL
       ORDER BY created_at ASC
       LIMIT p_batch_size
    ) t;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    moved_items := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  WITH moved AS (
    INSERT INTO public.feed_items_archive
      (id, source, external_id, title, description, url, source_url, category,
       channel, r2_image_key, reddit_image_url, has_image, impersonated_brand,
       country_code, upvotes, verified, published, source_created_at, body_md,
       tags, published_at, evidence_r2_key, embedding_model_version,
       provenance_tier, created_at)
    SELECT id, source, external_id, title, description, url, source_url, category,
           channel, r2_image_key, reddit_image_url, has_image, impersonated_brand,
           country_code, upvotes, verified, published, source_created_at, body_md,
           tags, published_at, evidence_r2_key, embedding_model_version,
           provenance_tier, created_at
      FROM public.feed_items
     WHERE id = ANY(v_ids)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_moved FROM moved;

  DELETE FROM public.feed_items WHERE id = ANY(v_ids);

  moved_items := v_moved;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_feed_items_batch(INT, INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_feed_items_batch(INT, INT) TO service_role;

-- ── 3. feed_items_all — union view (hot + archive) ───────────────────────

CREATE OR REPLACE VIEW public.feed_items_all AS
  SELECT id, source, external_id, title, description, url, source_url, category,
         channel, impersonated_brand, country_code, body_md, tags, published_at,
         provenance_tier, created_at, FALSE AS archived
    FROM public.feed_items
  UNION ALL
  SELECT id, source, external_id, title, description, url, source_url, category,
         channel, impersonated_brand, country_code, body_md, tags, published_at,
         provenance_tier, created_at, TRUE AS archived
    FROM public.feed_items_archive;

-- ── 4. prune_feed_ingestion_log — 90d rolling window ─────────────────────

CREATE OR REPLACE FUNCTION public.prune_feed_ingestion_log(
  p_days INT DEFAULT 90
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.feed_ingestion_log
  WHERE created_at < NOW() - (p_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_feed_ingestion_log(INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_feed_ingestion_log(INT) TO service_role;

-- ── 5. prune_feed_http_cache — 30d unused ETag entries ───────────────────

CREATE OR REPLACE FUNCTION public.prune_feed_http_cache(
  p_days INT DEFAULT 30
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.feed_http_cache
  WHERE fetched_at < NOW() - (p_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_feed_http_cache(INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_feed_http_cache(INT) TO service_role;

COMMENT ON FUNCTION public.archive_feed_items_batch(INT, INT) IS
  'Move regulator-narrative feed_items rows older than p_default_days (365 by default) to feed_items_archive. Cron loops until returned moved_items = 0.';

COMMENT ON FUNCTION public.prune_feed_ingestion_log(INT) IS
  'Drop feed_ingestion_log rows older than p_days. Operational telemetry only — no archive needed.';

COMMENT ON FUNCTION public.prune_feed_http_cache(INT) IS
  'Drop feed_http_cache rows where fetched_at older than p_days. Stale ETag entries 304-bypass anyway; pruning keeps the cache table small.';
