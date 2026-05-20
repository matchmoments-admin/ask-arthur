-- migration-v135: shop_checks — Shop Signal Stage 1 persistence table.
--
-- Stage 1 of Shop Guard. Stage 0/0.5 persist the shopSignal payload onto
-- scam_reports.analysis_result (the report-store.ts JSONB shim). This table
-- is the typed home for Stage 1+: one row per commerce-flagged analyze,
-- enriched in the background by the APIVoid Inngest fan-out (#321) writing
-- back via update_shop_check_signal.
--
-- Hot table (write-frequent — one row per commerce analyze). 90-day TTL,
-- swept one batch at a time by cleanup_expired_shop_checks via the
-- /api/cron/shop-checks-retention cron. Deliberately lean on indexes
-- (no HNSW, no GIN) per the CLAUDE.md hot-table rule.
--
-- Forward-only: populated only by analyzes that run AFTER this lands. The
-- 30-day Stage-0 measurement window keeps reading the JSONB shim — do NOT
-- backfill scam_reports.analysis_result.shopSignal into here, and do NOT
-- remove the report-store.ts shim until after the window closes (~2026-06-19).
--
-- Fully idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS)
-- so re-applying is safe.
--
-- Plan: docs/plans/shop-guard-v2.md §4 PR 3. Issue #320.

-- ---------------------------------------------------------------------------
-- v135.1 shop_checks table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.shop_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT,
  url_hash        BYTEA NOT NULL,
  url_normalized  TEXT NOT NULL,
  verdict         TEXT NOT NULL
                  CHECK (verdict IN ('SAFE','UNCERTAIN','SUSPICIOUS','HIGH_RISK')),
  composite_score SMALLINT NOT NULL,
  signal          JSONB NOT NULL,
  request_id      TEXT,
  source_surface  TEXT
                  CHECK (source_surface IN
                    ('web','extension','mobile-share','bot-telegram',
                     'bot-whatsapp','bot-slack','bot-messenger','b2b-api')),
  referrer_source TEXT,
  evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '90 days')
);

-- Partial unique — idempotency replay safety; NULL keys always insert fresh.
CREATE UNIQUE INDEX IF NOT EXISTS shop_checks_idempotency_key_uq
  ON public.shop_checks (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- "Recent checks for this URL" lookups.
CREATE INDEX IF NOT EXISTS shop_checks_url_hash_evaluated_idx
  ON public.shop_checks (url_hash, evaluated_at DESC);

-- Retention sweep — BRIN is the right shape for an append-mostly timestamp.
CREATE INDEX IF NOT EXISTS shop_checks_ttl_brin
  ON public.shop_checks USING brin (ttl_expires_at);

ALTER TABLE public.shop_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_checks_service_all ON public.shop_checks;
CREATE POLICY shop_checks_service_all ON public.shop_checks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.shop_checks IS
  'Shop Signal Stage 1 persistence — one row per commerce-flagged analyze. signal JSONB carries the ShopSignal payload + APIVoid paidProviderVerdict. 90-day TTL. Hot table — keep indexes lean (no HNSW/GIN).';
COMMENT ON COLUMN public.shop_checks.composite_score IS
  'Commerce-risk score 0-100. Set by the caller at write time; refined by the APIVoid enrichment write-back.';
COMMENT ON COLUMN public.shop_checks.signal IS
  'ShopSignal payload (isCommerce, commerceFlags, referrerSource) merged with the APIVoid paidProviderVerdict via update_shop_check_signal.';

-- ---------------------------------------------------------------------------
-- v135.2 upsert_shop_check — replay-safe write of a commerce-flagged analyze.
--
-- SECURITY INVOKER: only service_role is granted EXECUTE, and service_role
-- bypasses RLS, so the function runs with the caller's (service-role)
-- privileges. Returns the row id so the caller can address the later
-- APIVoid enrichment write-back (update_shop_check_signal).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_shop_check(
  p_idempotency_key TEXT,
  p_url_hash        BYTEA,
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
    (p_idempotency_key, p_url_hash, p_url_normalized, p_verdict,
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
  TEXT, BYTEA, TEXT, TEXT, SMALLINT, JSONB, TEXT, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- v135.3 update_shop_check_signal — partial JSONB merge for the APIVoid
-- Inngest enrichment write-back (#321). Idempotent on id; returns false if
-- the id no longer exists (e.g. retention swept it).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_shop_check_signal(
  p_id    UUID,
  p_patch JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.shop_checks
  SET signal = signal || p_patch
  WHERE id = p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_shop_check_signal(UUID, JSONB)
  TO service_role;

-- ---------------------------------------------------------------------------
-- v135.4 cleanup_expired_shop_checks — deletes ONE batch of TTL-expired rows
-- and returns the count. The retention cron (/api/cron/shop-checks-retention)
-- loops this until it returns 0. Expected duration: well under 1 minute per
-- batch on a healthy DB — does not trip the pg-stuck-query-watchdog.
-- statement_timeout is capped at a finite 300s (never 0) per CLAUDE.md.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_expired_shop_checks(
  p_batch_size INTEGER DEFAULT 5000
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  SET LOCAL statement_timeout = '300s';
  DELETE FROM public.shop_checks
  WHERE id IN (
    SELECT id FROM public.shop_checks
    WHERE ttl_expires_at < now()
    LIMIT GREATEST(p_batch_size, 0)
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_shop_checks(INTEGER)
  TO service_role;
