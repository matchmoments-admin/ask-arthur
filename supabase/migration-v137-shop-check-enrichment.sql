-- migration-v137: Deep Shop Check RPC adjustments — Shop Signal Stage 1 PR C.
--
-- The Deep Shop Check (docs/adr/0008-shop-signal-deep-check-user-initiated.md)
-- is a user-initiated enrichment: POST /api/shop-check creates a shop_checks
-- row, the shop-signal-enrich Inngest function fills in ABN + WHOIS + APIVoid,
-- then writes the result back. Two v135 RPCs need adjusting to support it.
--
-- (1) upsert_shop_check — v135 declared p_url_hash as BYTEA. Passing a BYTEA
--     argument through PostgREST/supabase-js .rpc() is fragile (no codebase
--     precedent for a bytea RPC arg). Switch the parameter to TEXT carrying a
--     hex digest and decode() to BYTEA inside the function — the url_hash
--     COLUMN stays bytea. The full upsert body is reproduced verbatim from
--     v135 with only that one change.
--
-- (2) update_shop_check_signal — v135's form only merges the `signal` JSONB.
--     The enrichment write-back also needs to set the real composite_score
--     and verdict COLUMNS (the initial upsert only had a placeholder score).
--     Extend with two optional params, defaulted NULL so the JSONB-only
--     merge contract is preserved.
--
-- Nothing calls either RPC yet (shop_checks is forward-only; #321's auto-fire
-- model that would have called them is superseded), so the explicit DROPs of
-- the old signatures are safe — no caller breakage.
--
-- No new indexes: shop_checks is a hot table; the PK (poll-by-id) and
-- shop_checks_url_hash_evaluated_idx (lookup-by-url) already cover every
-- access path. The v136 composite_score BETWEEN 0 AND 100 CHECK still guards
-- the column.
--
-- Fully idempotent (DROP IF EXISTS + CREATE OR REPLACE) so re-applying is safe.
--
-- Plan: docs/plans/shop-guard-v2.md §4. Issue #321 (superseded scope).

-- ---------------------------------------------------------------------------
-- v137.1 upsert_shop_check — p_url_hash BYTEA → TEXT (hex), decode internally.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.upsert_shop_check(
  TEXT, BYTEA, TEXT, TEXT, SMALLINT, JSONB, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.upsert_shop_check(
  p_idempotency_key TEXT,
  p_url_hash        TEXT,   -- hex-encoded sha256; decoded to BYTEA below
  p_url_normalized  TEXT,
  p_verdict         TEXT,
  p_composite_score SMALLINT,
  p_signal          JSONB,
  p_request_id      TEXT DEFAULT NULL,
  p_source_surface  TEXT DEFAULT NULL,
  p_referrer_source TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.shop_checks AS sc
    (idempotency_key, url_hash, url_normalized, verdict, composite_score,
     signal, request_id, source_surface, referrer_source)
  VALUES
    (p_idempotency_key, decode(p_url_hash, 'hex'), p_url_normalized, p_verdict,
     p_composite_score, p_signal, p_request_id, p_source_surface,
     p_referrer_source)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO UPDATE SET
    verdict         = excluded.verdict,
    composite_score = excluded.composite_score,
    signal          = excluded.signal,
    request_id      = excluded.request_id,
    source_surface  = excluded.source_surface,
    referrer_source = excluded.referrer_source,
    evaluated_at    = now(),
    ttl_expires_at  = now() + INTERVAL '90 days'
  RETURNING sc.id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_shop_check(
  TEXT, TEXT, TEXT, TEXT, SMALLINT, JSONB, TEXT, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- v137.2 update_shop_check_signal — also set composite_score + verdict columns.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.update_shop_check_signal(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.update_shop_check_signal(
  p_id              UUID,
  p_patch           JSONB,
  p_composite_score SMALLINT DEFAULT NULL,
  p_verdict         TEXT     DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_verdict IS NOT NULL
     AND p_verdict NOT IN ('SAFE','UNCERTAIN','SUSPICIOUS','HIGH_RISK') THEN
    RAISE EXCEPTION 'invalid verdict %', p_verdict;
  END IF;

  UPDATE public.shop_checks
  SET signal          = signal || p_patch,
      composite_score = COALESCE(p_composite_score, composite_score),
      verdict         = COALESCE(p_verdict, verdict)
  WHERE id = p_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.update_shop_check_signal(UUID, JSONB, SMALLINT, TEXT)
  TO service_role;
