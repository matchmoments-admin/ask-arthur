-- v196 — multi-source watchlist candidates
--        (Phase 1 of docs/plans/brand-convergence-seam.md)
--
-- WHY: reddit_watchlist_candidates was Reddit-only, but a brand people actively
-- REPORT to Arthur as impersonated (scam_reports.impersonated_brand) is an
-- equal-or-stronger demand signal for "what should we monitor". This makes the
-- human review queue genuinely multi-source: one row per canonical brand, with
-- a per-source breakdown, so a brand seen in BOTH streams floats to the top of
-- the pending queue (ORDER BY mention_count DESC). No new table, no rename —
-- the v187 `source` column already anticipated this.
--
-- SCOPE:
--   1. Add source_counts JSONB to reddit_watchlist_candidates + backfill.
--   2. upsert_watchlist_candidate(...) — source-aware, status-preserving,
--      recomputes mention_count = sum(source_counts).
--   3. aggregate_scam_report_brands(...) — a WINDOWED, read-only aggregate over
--      the hot scam_reports table (no column, no index, no write on it).
--
-- The old upsert_reddit_watchlist_candidate RPC is left in place (harmless,
-- unused after the fn repoint); a later cleanup migration can drop it.
--
-- Not a hot table (reddit_watchlist_candidates ~hundreds of rows). Idempotent.

-- 1. Per-source mention breakdown. mention_count stays the denormalised total
--    (= sum of source_counts) so the existing pending-queue index still orders
--    by it. Existing rows are all Reddit-sourced → backfill from mention_count.
ALTER TABLE public.reddit_watchlist_candidates
  ADD COLUMN IF NOT EXISTS source_counts JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.reddit_watchlist_candidates
SET source_counts = jsonb_build_object(COALESCE(source, 'reddit'), mention_count)
WHERE source_counts = '{}'::jsonb
  AND mention_count > 0;

-- 2. Source-aware, status-preserving upsert. Merges this source's count into
--    source_counts (overwriting just that key), recomputes mention_count as the
--    sum across ALL sources, refreshes raw_brand/last_seen_at, and never resets
--    `status` (a 'dismissed'/'reviewed' brand doesn't reappear as 'pending').
--    canonical is COALESCEd so a later null-canonical source never erases a
--    resolved one. LANGUAGE sql (no plpgsql search_path/variable_conflict risk).
CREATE OR REPLACE FUNCTION public.upsert_watchlist_candidate(
  p_brand_normalized   TEXT,
  p_raw_brand          TEXT,
  p_source             TEXT,
  p_source_count       INT,
  p_resolved_canonical TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  -- Alias the conflict target (wc) so the existing row's columns can be
  -- referenced without schema-qualification, which Postgres rejects in the
  -- ON CONFLICT SET clause. EXCLUDED is the proposed-insert row.
  INSERT INTO public.reddit_watchlist_candidates AS wc
    (brand_normalized, raw_brand, mention_count, resolved_canonical, source, source_counts)
  VALUES (
    p_brand_normalized,
    p_raw_brand,
    GREATEST(p_source_count, 0),
    p_resolved_canonical,
    p_source,
    jsonb_build_object(p_source, GREATEST(p_source_count, 0))
  )
  ON CONFLICT (brand_normalized) DO UPDATE SET
    source_counts = wc.source_counts
                    || jsonb_build_object(p_source, GREATEST(p_source_count, 0)),
    mention_count = (
      SELECT COALESCE(SUM(e.val::int), 0)
      FROM jsonb_each_text(
        wc.source_counts || jsonb_build_object(p_source, GREATEST(p_source_count, 0))
      ) AS e(key, val)
    ),
    raw_brand          = EXCLUDED.raw_brand,
    resolved_canonical = COALESCE(EXCLUDED.resolved_canonical, wc.resolved_canonical),
    last_seen_at       = NOW();
$$;

REVOKE EXECUTE ON FUNCTION
  public.upsert_watchlist_candidate(TEXT, TEXT, TEXT, INT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.upsert_watchlist_candidate(TEXT, TEXT, TEXT, INT, TEXT)
  TO service_role;

-- 3. Windowed brand aggregate over scam_reports. Read-only: NO column, NO index,
--    NO write on the hot table. Bounded by created_at >= p_since (served by the
--    existing idx_scam_reports_created), grouped server-side on
--    brand_normalize(impersonated_brand) so only aggregated rows ship to TS.
--    NO all-time count is computed (that would force a full-table scan). Counts
--    one report per row (the reported-scam analogue of one-post-per-mention).
--    SECURITY INVOKER: the only caller is the service_role cron, which bypasses
--    RLS — avoids the DEFINER search_path-exploitation surface (CLAUDE.md).
CREATE OR REPLACE FUNCTION public.aggregate_scam_report_brands(
  p_since     TIMESTAMPTZ,
  p_min_count INT
)
RETURNS TABLE (
  brand_normalized TEXT,
  raw_brand        TEXT,
  mention_count    INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT
    public.brand_normalize(sr.impersonated_brand)                        AS brand_normalized,
    (array_agg(sr.impersonated_brand ORDER BY sr.created_at DESC))[1]    AS raw_brand,
    COUNT(*)::int                                                        AS mention_count
  FROM public.scam_reports sr
  WHERE sr.created_at >= p_since
    AND sr.impersonated_brand IS NOT NULL
    AND public.brand_normalize(sr.impersonated_brand) IS NOT NULL
  GROUP BY public.brand_normalize(sr.impersonated_brand)
  HAVING COUNT(*) >= p_min_count;
$$;

REVOKE EXECUTE ON FUNCTION
  public.aggregate_scam_report_brands(TIMESTAMPTZ, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.aggregate_scam_report_brands(TIMESTAMPTZ, INT)
  TO service_role;
