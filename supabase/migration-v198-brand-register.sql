-- v198 — brand_register: the per-brand "brand 360" rollup
--        (Phase 3 of docs/plans/brand-convergence-seam.md)
--
-- WHY: the convergence artifact. One row per canonical brand carrying the
-- 30-day cross-stream picture — reported-scams, Reddit-intel, open clone alerts,
-- whether it's on the AU watchlist, and its curation status. This is the surface
-- that ALIGNS the three brand streams into a single queryable identity, powering
-- an admin brand-360 page and (later) prioritisation across the platform.
--
-- Pure-derived + fully rebuildable: refreshed nightly by the brand-register-
-- refresh Inngest fn from the canonical alias layer + the three streams. A
-- DROP TABLE is lossless (the next run rebuilds it). No hot table is altered;
-- every read the refresh does is a bounded 30-day windowed aggregate.
--
-- cross_stream_priority is an ADDITIVE ordering hint (scam*3 + clone*2 +
-- reddit*1). It NEVER blends into or mutates the deterministic clone severity
-- (ADR-0015); the constituent counts are stored individually so an operator
-- always sees the disagreement. Idempotent.

CREATE TABLE IF NOT EXISTS public.brand_register (
  canonical_brand       TEXT PRIMARY KEY,
  display_name          TEXT NOT NULL,
  on_au_watchlist       BOOLEAN NOT NULL DEFAULT false,
  scam_30d              INTEGER NOT NULL DEFAULT 0,
  reddit_30d            INTEGER NOT NULL DEFAULT 0,
  clone_open_alerts     INTEGER NOT NULL DEFAULT 0,
  -- Mirrors the watchlist-candidate review state for this brand, or NULL when
  -- the brand isn't (yet) a candidate. Derived — not human-set on this table.
  curation_status       TEXT
    CHECK (curation_status IS NULL OR curation_status IN ('pending', 'reviewed', 'dismissed')),
  cross_stream_priority  INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_register_priority
  ON public.brand_register (cross_stream_priority DESC, updated_at DESC);

ALTER TABLE public.brand_register ENABLE ROW LEVEL SECURITY;
-- No policies = service_role only (the refresh fn + the admin page's service
-- client). Matches brand_aliases (v174). Non-sensitive but no client needs it.

-- Atomic full-refresh: upsert every computed row, then delete brands no longer
-- in the computed universe — in ONE transaction so the admin page never sees a
-- half-empty table. GUARD: an empty batch is a no-op (never wipes the table),
-- so a failed upstream aggregation can't cause data loss.
CREATE OR REPLACE FUNCTION public.replace_brand_register(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) = 0 THEN
    RETURN (SELECT count(*)::int FROM public.brand_register);
  END IF;

  INSERT INTO public.brand_register (
    canonical_brand, display_name, on_au_watchlist,
    scam_30d, reddit_30d, clone_open_alerts,
    curation_status, cross_stream_priority, updated_at
  )
  SELECT
    r->>'canonical_brand',
    r->>'display_name',
    COALESCE((r->>'on_au_watchlist')::boolean, false),
    COALESCE((r->>'scam_30d')::int, 0),
    COALESCE((r->>'reddit_30d')::int, 0),
    COALESCE((r->>'clone_open_alerts')::int, 0),
    NULLIF(r->>'curation_status', ''),
    COALESCE((r->>'cross_stream_priority')::int, 0),
    NOW()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE COALESCE(r->>'canonical_brand', '') <> ''
  ON CONFLICT (canonical_brand) DO UPDATE SET
    display_name          = EXCLUDED.display_name,
    on_au_watchlist       = EXCLUDED.on_au_watchlist,
    scam_30d              = EXCLUDED.scam_30d,
    reddit_30d            = EXCLUDED.reddit_30d,
    clone_open_alerts     = EXCLUDED.clone_open_alerts,
    curation_status       = EXCLUDED.curation_status,
    cross_stream_priority = EXCLUDED.cross_stream_priority,
    updated_at            = NOW();

  DELETE FROM public.brand_register
  WHERE canonical_brand NOT IN (
    SELECT r->>'canonical_brand'
    FROM jsonb_array_elements(p_rows) AS r
    WHERE COALESCE(r->>'canonical_brand', '') <> ''
  );

  RETURN (SELECT count(*)::int FROM public.brand_register);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.replace_brand_register(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_brand_register(jsonb) TO service_role;

-- Per-brand open-clone-alert counts (server-side GROUP BY so the refresh fn
-- doesn't ship every alert row). Keyed by the sibling brand key added in v197.
CREATE OR REPLACE FUNCTION public.aggregate_open_clone_alerts_by_brand()
RETURNS TABLE (target_brand_normalized text, open_count int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT sca.target_brand_normalized, COUNT(*)::int
  FROM public.shopfront_clone_alerts sca
  WHERE sca.alert_state = 'open'
    AND sca.target_brand_normalized IS NOT NULL
  GROUP BY sca.target_brand_normalized;
$$;

REVOKE EXECUTE ON FUNCTION public.aggregate_open_clone_alerts_by_brand()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_open_clone_alerts_by_brand() TO service_role;

COMMENT ON TABLE public.brand_register IS
  'Per-brand "brand 360" rollup (v198, brand-convergence-seam Phase 3). One row per canonical brand with 30-day scam/reddit/clone counts + watchlist + curation state. Pure-derived, rebuilt nightly by brand-register-refresh; DROP TABLE is lossless. Service-role only.';