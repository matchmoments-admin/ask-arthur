-- v337 — monthly brand store: targeting_events (#1084, matcher v5 / #1150)
--
-- WHY. One registrant bulk-dropping one label across a TLD spread (`gonds.*`
-- × 9 in August 2026) counted as nine separate attempts on Bonds, and was a
-- large part of what made Bonds that month's spotlight. Every domain is a real
-- registration and stays an alert; but "how many times was this brand
-- targeted" is a different number, and it is the one the ranking, the
-- spotlight and the per-brand trend compare.
--
-- WHAT.
--   1. `targeting_events` — the brand's `clones` with each bulk registration
--      (one label, after IDN decode + confusable fold, on >= 4 distinct TLDs in
--      the month) counted once. Rule: apps/web/lib/clone-watch/clone-cohort.ts
--      `countTargetingEvents` / `BULK_REGISTRATION_MIN_TLDS`.
--   2. The ONE writer re-created to carry it. Nothing else changes.
--
-- NULL ≠ 0. There is NO backfill. A month frozen before v5 keeps NULL — it was
-- never measured in this unit, and back-filling it with `clones` would make a
-- v4 month look comparable to a v5 month. The report card reads a frozen month
-- with any NULL `targeting_events` as a method change for the per-brand
-- comparison (monthly-brand-store.ts `foldFrozenMonths`). A zero row (watched,
-- nothing found) is written as a measured 0.
--
-- `clones` keeps its published definition (distinct lookalike domains). The
-- month-level `matcher_version` moves to 'v5' with this change, so the honest
-- month-over-month (#1247) suppresses every delta across the boundary.
--
-- ORDER. Apply BEFORE the code that reads the column merges: the frozen-month
-- read SELECTs it, and a missing column fails that read (the card then falls
-- back to the live recount with a warn — degraded, not broken). The writer is
-- safe either way: jsonb_populate_recordset ignores an unknown key, and an
-- absent key lands NULL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, CREATE OR
-- REPLACE. Rollback: re-apply v325's writer, then DROP COLUMN targeting_events.

BEGIN;

ALTER TABLE public.clone_watch_monthly_brand_stats
  ADD COLUMN IF NOT EXISTS targeting_events integer;

ALTER TABLE public.clone_watch_monthly_brand_stats
  DROP CONSTRAINT IF EXISTS clone_watch_monthly_brand_stats_targeting_events_check;
ALTER TABLE public.clone_watch_monthly_brand_stats
  ADD CONSTRAINT clone_watch_monthly_brand_stats_targeting_events_check
  CHECK (targeting_events IS NULL OR (targeting_events >= 0 AND targeting_events <= clones));

COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.targeting_events IS
  'clones with each bulk registration (one label on >= 4 distinct TLDs in the month) counted once — how many times the brand was targeted. Compared by the ranking, spotlight and per-brand trend from matcher v5. NULL = not measured (every month frozen before v5); never back-filled from clones (v337, #1084).';

-- ── The one writer, re-created with targeting_events ────────────────────────
CREATE OR REPLACE FUNCTION public.write_clone_watch_monthly_stats(
  p_period_month   date,
  p_brand_rows     jsonb,
  p_registrar_rows jsonb,
  p_republish      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '60s'
AS $$
DECLARE
  v_frozen    timestamptz;
  v_now       timestamptz := now();
  v_brand_n   integer := 0;
  v_reg_n     integer := 0;
BEGIN
  IF p_period_month IS NULL
     OR p_period_month <> date_trunc('month', p_period_month)::date THEN
    RAISE EXCEPTION 'write_clone_watch_monthly_stats: period_month must be a month start, got %', p_period_month;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('clone_watch_monthly_stats'),
    (p_period_month - DATE '2000-01-01')
  );

  SELECT max(s.frozen_at) INTO v_frozen
  FROM public.clone_watch_monthly_brand_stats s
  WHERE s.period_month = p_period_month;

  IF v_frozen IS NOT NULL AND NOT COALESCE(p_republish, false) THEN
    RETURN jsonb_build_object(
      'status', 'frozen',
      'frozen_at', v_frozen,
      'brand_rows', 0,
      'registrar_rows', 0
    );
  END IF;

  PERFORM set_config('app.clone_watch_republish', 'on', true);

  DELETE FROM public.clone_watch_monthly_brand_stats
  WHERE period_month = p_period_month;

  INSERT INTO public.clone_watch_monthly_brand_stats (
    period_month, brand, brand_normalized, is_au, clones, targeting_events,
    reported_to_netcraft,
    likely_phishing, parked, taken_down, declined, escalated, weaponised,
    deliberate_clones, tactic_mix, intent_mix, tld_mix, hosting_mix, clusters,
    fingerprinted_clones, largest_cluster, weaponised_ever,
    weaponised_after_decline, re_taken_down, taken_down_in_month, alert_ids,
    new_registered, new_deliberate, active_stock_eom, stock_by_status,
    swept_domains, coverage_full_month, matcher_version, classifier_version,
    liveness_checked_at,
    frozen_at
  )
  SELECT
    p_period_month, r.brand, r.brand_normalized, COALESCE(r.is_au, false),
    r.clones, r.targeting_events, r.reported_to_netcraft, r.likely_phishing, r.parked, r.taken_down,
    r.declined, r.escalated, r.weaponised, r.deliberate_clones, r.tactic_mix,
    r.intent_mix, r.tld_mix, r.hosting_mix, r.clusters, r.fingerprinted_clones,
    r.largest_cluster, r.weaponised_ever, r.weaponised_after_decline,
    r.re_taken_down, r.taken_down_in_month, r.alert_ids,
    r.new_registered, r.new_deliberate, r.active_stock_eom, r.stock_by_status,
    r.swept_domains, r.coverage_full_month, r.matcher_version,
    r.classifier_version, r.liveness_checked_at,
    v_now
  FROM jsonb_populate_recordset(
    NULL::public.clone_watch_monthly_brand_stats,
    COALESCE(p_brand_rows, '[]'::jsonb)
  ) AS r;
  GET DIAGNOSTICS v_brand_n = ROW_COUNT;

  DELETE FROM public.clone_watch_monthly_registrar_stats
  WHERE period_month = p_period_month;

  INSERT INTO public.clone_watch_monthly_registrar_stats (
    period_month, registrar, clones, weaponised, median_days_to_weaponise
  )
  SELECT p_period_month, r.registrar, r.clones, COALESCE(r.weaponised, 0),
         r.median_days_to_weaponise
  FROM jsonb_populate_recordset(
    NULL::public.clone_watch_monthly_registrar_stats,
    COALESCE(p_registrar_rows, '[]'::jsonb)
  ) AS r;
  GET DIAGNOSTICS v_reg_n = ROW_COUNT;

  PERFORM set_config('app.clone_watch_republish', 'off', true);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_frozen IS NULL THEN 'written' ELSE 'republished' END,
    'frozen_at', v_now,
    'previous_frozen_at', v_frozen,
    'brand_rows', v_brand_n,
    'registrar_rows', v_reg_n
  );
END;
$$;

COMMENT ON FUNCTION public.write_clone_watch_monthly_stats(date, jsonb, jsonb, boolean) IS
  'The ONE writer of clone_watch_monthly_brand_stats + _registrar_stats (v319, columns extended v325, v337). Atomic replace of a month, freezing it (frozen_at = now()). A frozen month is refused ({status:"frozen"}) unless p_republish, which restates it and re-stamps frozen_at ({status:"republished", previous_frozen_at}). Caller: clone-watch-report-summary.';

REVOKE ALL ON FUNCTION public.write_clone_watch_monthly_stats(date, jsonb, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_clone_watch_monthly_stats(date, jsonb, jsonb, boolean)
  TO service_role;
SELECT set_config('app.clone_watch_republish', 'off', true);

COMMIT;
