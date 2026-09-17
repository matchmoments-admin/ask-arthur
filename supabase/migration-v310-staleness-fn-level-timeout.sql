-- migration-v310-staleness-fn-level-timeout.sql
--
-- The in-body `SET LOCAL statement_timeout = '90s'` in the v308 staleness
-- RPCs is DECORATIVE when the RPC is called through PostgREST — which is how
-- every supabase-js `.rpc()` call reaches it. Measured on prod 2026-09-17:
--
--   * PostgREST logs in as `authenticator`, whose rolconfig carries
--     `statement_timeout=8s`; `SET ROLE service_role` (rolconfig NULL) does
--     not replace it. Postgres arms the statement timer when the top-level
--     statement starts; a SET LOCAL executed INSIDE the running statement
--     changes the GUC (current_setting() reads the new value) but never
--     re-arms the timer. Probe: a SECURITY DEFINER fn that does
--     `SET LOCAL statement_timeout='60s'; PERFORM pg_sleep(12)` returned
--     `timeout_now: 1min` for a 3 s sleep and `57014 canceling statement due
--     to statement timeout` at 8 s for a 12 s sleep.
--   * The function-level SET clause (`CREATE FUNCTION ... SET statement_timeout
--     = '60s' AS $$...$$`) IS honoured: the same 12 s sleep completed. It is
--     applied on function entry through the GUC nesting mechanism, which does
--     re-arm. The seven newsletter RPCs already use this form.
--
-- What it did: the first 05:50 run of pipeline-staleness-check-ips on v308
-- failed 4/4 attempts at ~9 s each (`mark_stale_ips RPC failed: canceling
-- statement due to statement timeout`, Vercel runtime log) and was then
-- finish-cancelled — the same outcome as before v308, for a different reason.
-- Calling the RPC as `postgres` via the Management API, where no 8 s cap
-- exists, returns in 2–3 s, which is why the earlier EXPLAINs did not show it.
--
-- Nine public functions carry the decorative in-body form (the six others —
-- _prune_chunked, anonymise_expired_footprints, cleanup_expired_shop_checks,
-- prune_cost_telemetry, sweep_inactive_monitors, upsert_clone_alerts_batch —
-- are a fleet ticket on map #1143, not this migration).
--
-- Idempotent: CREATE OR REPLACE with the same (int, int) signatures as v308.
-- Bodies unchanged except the SET LOCAL line is removed. Reverse: reapply v308.

BEGIN;
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.mark_stale_urls(
  p_stale_days INT DEFAULT 7,
  p_limit INT DEFAULT 2000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '90s'
AS $$
DECLARE
  v_count  INT;
  v_exempt TEXT[];
BEGIN
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
        AND unique_reporter_count < 3
        AND confidence_level NOT IN ('high', 'confirmed')
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

CREATE OR REPLACE FUNCTION public.mark_stale_ips(
  p_stale_days INT DEFAULT 7,
  p_limit INT DEFAULT 5000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '90s'
AS $$
DECLARE
  v_count INT;
BEGIN
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

CREATE OR REPLACE FUNCTION public.mark_stale_crypto_wallets(
  p_stale_days INT DEFAULT 14,
  p_limit INT DEFAULT 5000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '90s'
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.scam_crypto_wallets
  SET is_active = FALSE,
      staleness_checked_at = now()
  WHERE id IN (
    SELECT id
    FROM public.scam_crypto_wallets
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

COMMIT;
