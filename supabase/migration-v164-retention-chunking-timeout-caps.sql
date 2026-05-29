-- migration-v164-retention-chunking-timeout-caps.sql
--
-- Chunk + statement_timeout cap the unbounded retention sweeps
-- (cron-hardening #522 M-cost / M-telco).
--
-- ROOT CAUSE: prune_cost_telemetry (v112), prune_telco_events (v113), and the
-- phone-footprint sweeps (v75) each ran ONE unbounded DELETE/UPDATE per table
-- with NO statement_timeout cap. Safe at today's volume, but the first run
-- after a backlog (or once Vonage/SIM-swap traffic lands on the telco tables)
-- is a single giant statement that can hold locks + ride the pooler default
-- toward the pg-stuck-query-watchdog 10-min page. Incident 2026-05-09 banned
-- `statement_timeout = 0`; the conventions require a finite cap ('300s') + ≤5K
-- chunking for long write loops.
--
-- FIX: each function now (a) `SET LOCAL statement_timeout = '300s'` as a finite
-- backstop, and (b) deletes/updates in ≤5K batches by primary key in a loop
-- until drained. All target tables key on `id` (verified). Same return shapes
-- as before, so the Inngest wrappers are unchanged.
--
-- search_path tightened to '' with fully-qualified refs per supabase/CLAUDE.md
-- §4 (these are SECURITY DEFINER). Only pg_catalog builtins used.
--
-- Idempotent: CREATE OR REPLACE; re-running is safe.

-- ── cost_telemetry (90d) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prune_cost_telemetry(
  p_days INT DEFAULT 90
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total INT := 0;
  v_batch INT;
BEGIN
  SET LOCAL statement_timeout = '300s';
  LOOP
    DELETE FROM public.cost_telemetry
     WHERE id IN (
       SELECT id FROM public.cost_telemetry
        WHERE created_at < NOW() - (p_days || ' days')::INTERVAL
        ORDER BY id
        LIMIT 5000
     );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_total := v_total + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_cost_telemetry(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_cost_telemetry(INT) TO service_role;

-- ── telco events (730d forensic / 365d standard) ───────────────────────────
-- Helper: chunked DELETE on one table+timestamp column, returns total deleted.
CREATE OR REPLACE FUNCTION public._prune_chunked(
  p_table TEXT,
  p_ts_col TEXT,
  p_interval TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total INT := 0;
  v_batch INT;
BEGIN
  SET LOCAL statement_timeout = '300s';
  LOOP
    EXECUTE format(
      'DELETE FROM public.%I WHERE id IN (SELECT id FROM public.%I WHERE %I < NOW() - $1::interval ORDER BY id LIMIT 5000)',
      p_table, p_table, p_ts_col
    ) USING p_interval;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_total := v_total + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public._prune_chunked(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._prune_chunked(TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.prune_telco_events()
RETURNS TABLE (
  table_name text,
  rows_deleted int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY SELECT 'sim_swap_events'::text,              public._prune_chunked('sim_swap_events','created_at','730 days');
  RETURN QUERY SELECT 'device_swap_events'::text,           public._prune_chunked('device_swap_events','created_at','730 days');
  RETURN QUERY SELECT 'subscriber_match_checks'::text,      public._prune_chunked('subscriber_match_checks','created_at','365 days');
  RETURN QUERY SELECT 'telco_signal_history'::text,         public._prune_chunked('telco_signal_history','observed_at','365 days');
  RETURN QUERY SELECT 'telco_api_usage'::text,              public._prune_chunked('telco_api_usage','created_at','365 days');
  RETURN QUERY SELECT 'phone_lookups'::text,                public._prune_chunked('phone_lookups','created_at','365 days');
  RETURN QUERY SELECT 'phone_footprint_otp_attempts'::text, public._prune_chunked('phone_footprint_otp_attempts','attempted_at','365 days');
END;
$$;
REVOKE ALL ON FUNCTION public.prune_telco_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_telco_events() TO service_role;

-- ── phone-footprint anonymisation (PII, 7d grace) ──────────────────────────
CREATE OR REPLACE FUNCTION public.anonymise_expired_footprints()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total INT := 0;
  v_batch INT;
BEGIN
  SET LOCAL statement_timeout = '300s';
  LOOP
    UPDATE public.phone_footprints
       SET msisdn_e164   = 'REDACTED',
           pillar_scores = '{}'::jsonb,
           explanation   = NULL,
           anonymised_at = NOW()
     WHERE id IN (
       SELECT id FROM public.phone_footprints
        WHERE expires_at < NOW() - INTERVAL '7 days'
          AND anonymised_at IS NULL
        ORDER BY id
        LIMIT 5000
     );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_total := v_total + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.anonymise_expired_footprints() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymise_expired_footprints() TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_inactive_monitors()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total INT := 0;
  v_batch INT;
BEGIN
  SET LOCAL statement_timeout = '300s';
  LOOP
    UPDATE public.phone_footprint_monitors
       SET status     = 'consent_lapsed',
           updated_at = NOW()
     WHERE id IN (
       SELECT id FROM public.phone_footprint_monitors
        WHERE status = 'active'
          AND soft_deleted_at IS NULL
          AND consent_expires_at < NOW()
        ORDER BY id
        LIMIT 5000
     );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_total := v_total + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_inactive_monitors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_inactive_monitors() TO service_role;
