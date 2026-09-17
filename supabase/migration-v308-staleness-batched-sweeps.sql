-- migration-v308-staleness-batched-sweeps.sql
--
-- The three feed-staleness sweeps (URLs / IPs / crypto wallets) become one
-- shape: a bounded batch selected THROUGH the partial staleness index, each
-- call its own short transaction, looped by the Inngest fn until a short batch.
-- Closes the #1069 cancellation class for the pipeline crons (#1156).
--
-- WHAT WAS WRONG, measured on prod 2026-09-17:
--
--   * mark_stale_ips (v237) picked its batch with `ORDER BY id LIMIT 5000`.
--     The planner treats that as "walk the pkey in order and stop at 5000
--     matches" — which is a full pkey walk when few or no rows match:
--     EXPLAIN ANALYZE 34.5 s warm-cache, Rows Removed by Filter: 1,130,781,
--     rows=0. The partial index idx_scam_ips_staleness
--     (last_seen_in_feed WHERE is_active AND last_seen_in_feed IS NOT NULL)
--     exists and is exactly the predicate — ordering by last_seen_in_feed
--     instead lets the same query use it: 1.0 s. Cold at 03:10 the first
--     batch alone blew the 4 m finish; cancelled 7/7 runs Sep 9–16.
--
--   * mark_stale_urls (v262) was ONE unbounded UPDATE. 18 s when idle, but
--     the 03:00 cron sits inside the window where the tier-12h bulk IOC
--     mirrors land (GHA dispatches the 00:00 tick 1–4 h late: 84K–136K
--     scam_urls upserts at 03–04 UTC), and under that contention the single
--     statement never finished inside the finish budget. Cancelled every day
--     Sep 14–17; no URL had been marked stale since Sep 13 (11,217 backlog).
--     A cancelled run rolls the whole UPDATE back, so a bounded batch is the
--     fix, not a bigger timeout: each batch commits on its own.
--
--   * mark_stale_crypto_wallets (v14) was fine (small table) but had a
--     different signature, so the Inngest side could not share one loop.
--
-- Ordering by last_seen_in_feed is not part of the interface — batches are
-- independent transactions and the caller loops until a short batch — it is
-- purely what drives the index. The per-call statement_timeout is 90 s: the
-- Inngest loop breaks on its own in-step budget between batches, so a single
-- batch is the largest unit that can be lost.
--
-- Signatures change (int) → (int, int) for urls and wallets; the old 1-arg
-- overloads are dropped so each RPC name has exactly one meaning. The only
-- callers are packages/scam-engine/src/inngest/staleness*.ts, updated in the
-- same PR. Idempotent: CREATE OR REPLACE + DROP IF EXISTS. Reverse: reapply
-- v262 (urls), v237 (ips), v14 (wallets).

BEGIN;
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. URLs — bounded batch, keeps the v262 exempt-feed clause
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mark_stale_urls(INT);

CREATE OR REPLACE FUNCTION public.mark_stale_urls(
  p_stale_days INT DEFAULT 7,
  p_limit INT DEFAULT 2000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count  INT;
  v_exempt TEXT[];
BEGIN
  SET LOCAL statement_timeout = '90s';

  SELECT coalesce(array_agg(slug), ARRAY[]::text[])
    INTO v_exempt
    FROM public.feed_sources
   WHERE staleness_exempt;

  UPDATE public.scam_urls
     SET is_active = FALSE,
         staleness_checked_at = now()
   WHERE id IN (
     SELECT id
       FROM public.scam_urls
      WHERE is_active = TRUE
        AND last_seen_in_feed IS NOT NULL
        AND last_seen_in_feed < now() - (p_stale_days || ' days')::INTERVAL
        -- Preserve community-validated URLs (3+ unique reporters)
        AND unique_reporter_count < 3
        -- Preserve high-confidence URLs from Claude analysis
        AND confidence_level NOT IN ('high', 'confirmed')
        -- Preserve historical-signal findings whose ONLY source is an exempt
        -- feed (v262). `<@` on an empty v_exempt matches only empty arrays.
        AND NOT (feed_sources <@ v_exempt)
      ORDER BY last_seen_in_feed
      LIMIT p_limit
   );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days,
    'batch_limit', p_limit,
    'exempt_feeds', v_exempt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_urls(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_urls(INT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. IPs — same body as v237, ORDER BY drives idx_scam_ips_staleness
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_stale_ips(
  p_stale_days INT DEFAULT 7,
  p_limit INT DEFAULT 5000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INT;
BEGIN
  SET LOCAL statement_timeout = '90s';

  UPDATE public.scam_ips
  SET is_active = FALSE,
      staleness_checked_at = now()
  WHERE id IN (
    SELECT id
    FROM public.scam_ips
    WHERE is_active = TRUE
      AND last_seen_in_feed IS NOT NULL
      AND last_seen_in_feed < now() - (p_stale_days || ' days')::INTERVAL
      AND confidence_level NOT IN ('high', 'confirmed')
    ORDER BY last_seen_in_feed
    LIMIT p_limit
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days,
    'batch_limit', p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_ips(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_ips(INT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Crypto wallets — brought onto the same shape (idx_scam_wallets_staleness)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mark_stale_crypto_wallets(INT);

CREATE OR REPLACE FUNCTION public.mark_stale_crypto_wallets(
  p_stale_days INT DEFAULT 14,
  p_limit INT DEFAULT 5000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INT;
BEGIN
  SET LOCAL statement_timeout = '90s';

  UPDATE public.scam_crypto_wallets
  SET is_active = FALSE,
      staleness_checked_at = now()
  WHERE id IN (
    SELECT id
    FROM public.scam_crypto_wallets
    WHERE is_active = TRUE
      AND last_seen_in_feed IS NOT NULL
      AND last_seen_in_feed < now() - (p_stale_days || ' days')::INTERVAL
      -- Preserve high-confidence wallets
      AND confidence_level NOT IN ('high', 'confirmed')
    ORDER BY last_seen_in_feed
    LIMIT p_limit
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'deactivated_count', v_count,
    'stale_days', p_stale_days,
    'batch_limit', p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_crypto_wallets(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_crypto_wallets(INT, INT) TO service_role;

COMMENT ON FUNCTION public.mark_stale_urls(INT, INT) IS
  'v308: bounded-batch feed-staleness sweep (index-driven via idx_scam_urls_staleness). Looped by pipeline-staleness-check until a short batch. Exempt feeds per feed_sources.staleness_exempt (v262).';
COMMENT ON FUNCTION public.mark_stale_ips(INT, INT) IS
  'v308: bounded-batch feed-staleness sweep (index-driven via idx_scam_ips_staleness). Looped by pipeline-staleness-check-ips until a short batch.';
COMMENT ON FUNCTION public.mark_stale_crypto_wallets(INT, INT) IS
  'v308: bounded-batch feed-staleness sweep (index-driven via idx_scam_wallets_staleness). Looped by pipeline-staleness-check-wallets until a short batch.';

COMMIT;
