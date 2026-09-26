-- v325 — monthly brand store v2: live-at-month-end stock + new-this-month (#1225)
--
-- WHY. The monthly per-brand store (v193/v296/v319) counts a FLOW — lookalikes
-- first seen during the month. Nothing measured the STOCK a brand actually
-- faces ("how many lookalikes are still up at month end"), watched brands with
-- nothing found had no row (so "0 this month, we were watching" was never said),
-- the store's `parked` column is urlscan-only (Aug: 1 vs 91 by nameserver), and
-- no row recorded which matcher/classifier or how large a feed produced it —
-- so a month-over-month delta could not tell attackers from methodology.
--
-- WHAT.
--   1. New nullable columns on clone_watch_monthly_brand_stats. NULL means
--      "not measured", never 0 (a month published before this migration never
--      had a liveness snapshot, and saying 0 would be a claim):
--        new_registered      — lookalikes first seen this month (= clones)
--        new_deliberate      — of those, classified deliberate clones
--        active_stock_eom    — lookalikes of this brand from ANY month still
--                              up at the month-end liveness snapshot
--                              (statuses live_phishing | live | parked)
--        stock_by_status     — the snapshot's per-status counts for the brand
--        swept_domains       — NRD domains swept in the month (feed denominator;
--                              the free feed is capped at 70,000/day — #1228)
--        coverage_full_month — the brand domain was watched for the whole month
--                              with no mid-month change in who is watched
--        matcher_version     — lexical matcher version that produced the month
--        classifier_version  — pre-classifier model id(s) in the cohort ("+"-joined)
--        liveness_checked_at — when the month-end snapshot ran (NULL = none)
--   2. write_clone_watch_monthly_stats (the ONE writer, v319) re-created with
--      the extended INSERT column list — it enumerates columns, so a new column
--      is silently dropped until the writer names it.
--   3. Backfill Jun–Aug (frozen) under the v319 republish GUC: new_registered,
--      new_deliberate, swept_domains, coverage_full_month, matcher_version 'v4'
--      (all three months were re-classified by v4 on 2026-09-04). active_stock_eom
--      / stock_by_status / liveness_checked_at stay NULL — never measured.
--      Existing columns and frozen_at are NOT touched.
--   4. clone_liveness_snapshots — one row per active-stock alert per month-end,
--      written by clone-watch-month-end-liveness (DNS only, no paid calls) and
--      read by clone-watch-report-summary.
--   4b. clone_liveness_runs — the run's completion record; without it the
--      snapshot is not trusted (a partial snapshot is not a measurement).
--   5. reset_clone_alert_dead_dormancy — the month-end DNS pass re-opens a
--      v326 dead-dormant row whose name now resolves to a host.
--
-- Cold tables (~300 brand rows/month, ~3k snapshot rows/month). Grants per v324:
-- new objects get nothing for anon/authenticated; service_role keeps its own
-- defaults. RLS deny-all on the new table (defence in depth).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, backfills
-- are WHERE … IS NULL, CREATE OR REPLACE on the writer (same signature, so its
-- v319 ACL is kept — the explicit REVOKE/GRANT below restates it anyway).
--
-- Rollback: DROP TABLE clone_liveness_snapshots, clone_liveness_runs; DROP FUNCTION
-- reset_clone_alert_dead_dormancy(bigint[]); the columns are additive and may stay; re-apply v319's writer body to stop writing them.

BEGIN;

SELECT set_config('app.clone_watch_republish', 'on', true);

ALTER TABLE public.clone_watch_monthly_brand_stats
  ADD COLUMN IF NOT EXISTS new_registered      integer,
  ADD COLUMN IF NOT EXISTS new_deliberate      integer,
  ADD COLUMN IF NOT EXISTS active_stock_eom    integer,
  ADD COLUMN IF NOT EXISTS stock_by_status     jsonb,
  ADD COLUMN IF NOT EXISTS swept_domains       bigint,
  ADD COLUMN IF NOT EXISTS coverage_full_month boolean,
  ADD COLUMN IF NOT EXISTS matcher_version     text,
  ADD COLUMN IF NOT EXISTS classifier_version  text,
  ADD COLUMN IF NOT EXISTS liveness_checked_at timestamptz;

COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.new_registered IS
  'Lookalikes of this brand FIRST SEEN in the month (flow; equals `clones`). NULL = not recorded (v325).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.new_deliberate IS
  'Of new_registered, the ones the pre-classifier judged deliberate clones (= deliberate_clones). NULL = not recorded (v325).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.active_stock_eom IS
  'STOCK: lookalikes of this brand from ANY first-seen month whose month-end liveness snapshot status is live_phishing, live or parked. NULL = no COMPLETE snapshot for the month (clone_liveness_runs), or more than 20% of the brand''s rows unverified — never measured, NOT zero (v325).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.stock_by_status IS
  'Month-end snapshot counts for the brand by status {live_phishing, live, parked, held, no_host, gone, unverified}. NULL = no snapshot (v325).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.swept_domains IS
  'NRD domains swept in the month (sum of nrd_daily_ingest domains_scanned) — the feed denominator. The free feed is capped at 70,000/day (#1228), so this is a sample size, not the registration total. NULL = not recorded (v325).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.coverage_full_month IS
  'True when the brand domain was on the watchlist for the WHOLE month and no watched brand sharing the domain joined or left mid-month (brand_coverage_history). NULL = coverage unreadable (v325).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.matcher_version IS
  'Lexical matcher version that produced the month (shopfront-glue LEXICAL_MATCHER_VERSION). A delta across a version change is a methodology change (v325).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.classifier_version IS
  'Pre-classifier model id(s) behind the brand''s month cohort, "+"-joined, most frequent first (e.g. claude-haiku-4-5-20251001+jev-1.13.0 for a month straddling the swap). NULL = no classified member (v325).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.liveness_checked_at IS
  'When the month-end liveness snapshot behind active_stock_eom ran. NULL = none (v325).';

-- ── Backfill the frozen months (Jun–Aug) — only the new, derivable columns ──
UPDATE public.clone_watch_monthly_brand_stats s
SET new_registered = s.clones
WHERE s.new_registered IS NULL;

UPDATE public.clone_watch_monthly_brand_stats s
SET new_deliberate = s.deliberate_clones
WHERE s.new_deliberate IS NULL AND s.deliberate_clones IS NOT NULL;

-- Only the months the v4 matcher actually produced (all three were restated
-- under v4 on 2026-09-04). An earlier month, if any, stays NULL — unknown.
UPDATE public.clone_watch_monthly_brand_stats s
SET matcher_version = 'v4'
WHERE s.matcher_version IS NULL
  AND s.period_month BETWEEN DATE '2026-06-01' AND DATE '2026-08-01';

-- Only a month the ingest telemetry COVERS: its first row must fall within
-- the month's first three days. nrd_daily_ingest telemetry begins 2026-06-27,
-- so June (ingested from 1 June, telemetry for 4 days) would otherwise read
-- ~280k against ~2.1M for Jul/Aug — a false "the feed was a tenth the size"
-- on a frozen month. Such a month stays NULL (not recorded). Twin of
-- monthly-brand-store.ts sumDomainsScanned (SWEPT_COVERAGE_GRACE_DAYS).
WITH swept AS (
  SELECT date_trunc('month', t.created_at)::date AS period_month,
         sum((t.metadata->>'domains_scanned')::bigint) AS n,
         min(t.created_at) AS first_row
  FROM public.cost_telemetry t
  WHERE t.feature = 'shopfront_clone_watch'
    AND t.operation = 'nrd_daily_ingest'
    AND t.metadata ? 'domains_scanned'
  GROUP BY 1
  HAVING min(t.created_at) < date_trunc('month', min(t.created_at)) + interval '3 days'
)
UPDATE public.clone_watch_monthly_brand_stats s
SET swept_domains = swept.n
FROM swept
WHERE s.period_month = swept.period_month
  AND s.swept_domains IS NULL;

-- Same rule as brand-coverage.ts domainCoveredForMonth: at least one coverage
-- row for the domain covers the whole month, and no row for the domain starts
-- or ends inside it (a composition change mid-month).
WITH cov AS (
  SELECT lower(btrim(h.brand_domain)) AS domain, h.covered_from, h.covered_to
  FROM public.brand_coverage_history h
  WHERE h.brand_domain IS NOT NULL
),
judged AS (
  SELECT s.period_month, s.brand,
         bool_or(
           c.covered_from <= s.period_month
           AND (c.covered_to IS NULL OR c.covered_to > (s.period_month + interval '1 month')::date)
         ) AS any_covered,
         bool_or(
           c.covered_from < (s.period_month + interval '1 month')::date
           AND (c.covered_to IS NULL OR c.covered_to > s.period_month)
           AND NOT (
             c.covered_from <= s.period_month
             AND (c.covered_to IS NULL OR c.covered_to > (s.period_month + interval '1 month')::date)
           )
         ) AS partial_overlap
  FROM public.clone_watch_monthly_brand_stats s
  JOIN cov c ON c.domain = lower(btrim(s.brand))
  GROUP BY s.period_month, s.brand
)
UPDATE public.clone_watch_monthly_brand_stats s
SET coverage_full_month = (j.any_covered AND NOT j.partial_overlap)
FROM judged j
WHERE s.period_month = j.period_month
  AND s.brand = j.brand
  AND s.coverage_full_month IS NULL;

-- A domain with no coverage row at all was never on the watchlist as that
-- domain: false. (Only when the table has rows — an empty table is "unknown",
-- the same as the TS producer's unreadable-coverage case.)
UPDATE public.clone_watch_monthly_brand_stats s
SET coverage_full_month = false
WHERE s.coverage_full_month IS NULL
  AND EXISTS (SELECT 1 FROM public.brand_coverage_history)
  AND NOT EXISTS (
    SELECT 1 FROM public.brand_coverage_history h
    WHERE lower(btrim(h.brand_domain)) = lower(btrim(s.brand))
  );

-- ── Month-end liveness snapshots ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clone_liveness_snapshots (
  period_month     date        NOT NULL,
  alert_id         bigint      NOT NULL,
  candidate_domain text        NOT NULL,
  brand            text        NOT NULL,
  status           text        NOT NULL
    CHECK (status IN ('live_phishing', 'live', 'parked', 'held', 'no_host', 'gone', 'unverified')),
  dns              jsonb,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_month, alert_id)
);

CREATE INDEX IF NOT EXISTS idx_clone_liveness_snapshots_brand
  ON public.clone_liveness_snapshots (period_month, brand);

ALTER TABLE public.clone_liveness_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.clone_liveness_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clone_liveness_snapshots TO service_role;

COMMENT ON TABLE public.clone_liveness_snapshots IS
  'Month-end liveness of every active-stock lookalike (source nrd, not taken_down / dormant / fp), one row per alert per month. DNS only (A/AAAA/NS) + stored registry-hold status — no paid calls. Writer: clone-watch-month-end-liveness (1st 01:00 UTC). Reader: clone-watch-report-summary → clone_watch_monthly_brand_stats.active_stock_eom (v325).';
COMMENT ON COLUMN public.clone_liveness_snapshots.status IS
  'gone (NXDOMAIN) > held (clienthold/serverhold) > parked (parking NS / for-sale) > live_phishing (weaponised and resolving) > live (resolves) > no_host (registered, no address) > unverified (resolver failure or not probed). Rule: clone-metrics.ts stockStatus (v325).';

-- One row per completed month-end run. The summary persists active_stock_eom
-- ONLY when this row exists and the snapshot row count equals `written`: a
-- run that died mid-walk (a chunk exhausted its retries, a silent finish-
-- timeout cancel) leaves a partial snapshot, and folding a partial snapshot
-- would freeze fabricated zeros for every brand whose stock sat in the
-- unreached ids (review of #1225). No row = not measured = NULL.
CREATE TABLE IF NOT EXISTS public.clone_liveness_runs (
  period_month date        PRIMARY KEY,
  stock        integer     NOT NULL,
  written      integer     NOT NULL,
  unverified   integer     NOT NULL,
  not_probed   integer     NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clone_liveness_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.clone_liveness_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clone_liveness_runs TO service_role;

COMMENT ON TABLE public.clone_liveness_runs IS
  'Completion record of clone-watch-month-end-liveness, one row per month. Written LAST by the run (after every snapshot row); deleted FIRST when a run (re)starts. The summary trusts clone_liveness_snapshots for a month only when this row exists and count(snapshots) = written (v325).';

-- ── Dead-dormancy reset (month-end DNS pass) ────────────────────────────────
-- v326 (#1240) stops the recheck worklist offering a row once urlscan has
-- refused it as unresolvable eight times running (urlscan_uuid IS NULL AND
-- urlscan_failure_streak >= 8 AND evidence status '400') — otherwise terminal.
-- The month-end liveness pass DNS-probes every active-stock row anyway; when a
-- dormant one now resolves to a host (A/AAAA), it calls this to zero the
-- streak so the recheck worklist picks it up again.
--
-- The predicate is re-checked HERE, not trusted from the caller: only rows
-- that are dormant by exactly the v326 rule are touched, so the function
-- cannot be used to reset an arbitrary streak. Harmless before v326 is
-- applied (the rows simply were not being excluded yet). Returns the ids reset.
CREATE OR REPLACE FUNCTION public.reset_clone_alert_dead_dormancy(p_alert_ids bigint[])
RETURNS bigint[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
  WITH reset AS (
    UPDATE public.shopfront_clone_alerts sca
    SET urlscan_failure_streak = 0
    WHERE sca.id = ANY (COALESCE(p_alert_ids, '{}'::bigint[]))
      AND sca.urlscan_uuid IS NULL
      AND sca.urlscan_failure_streak >= 8
      AND COALESCE(sca.urlscan_evidence->>'status', '') = '400'
    RETURNING sca.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::bigint[]) FROM reset;
$$;

COMMENT ON FUNCTION public.reset_clone_alert_dead_dormancy(bigint[]) IS
  'Zero urlscan_failure_streak for the given alerts that are dead-dormant by the v326 rule (urlscan_uuid NULL, streak >= 8, evidence status 400), so the recheck worklist offers them again. Caller: clone-watch-month-end-liveness, for dormant rows whose month-end DNS now resolves to a host. Returns the ids reset (v325).';

REVOKE ALL ON FUNCTION public.reset_clone_alert_dead_dormancy(bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_clone_alert_dead_dormancy(bigint[])
  TO service_role;

-- ── The one writer, re-created with the v325 columns ────────────────────────
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
    period_month, brand, brand_normalized, is_au, clones, reported_to_netcraft,
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
    r.clones, r.reported_to_netcraft, r.likely_phishing, r.parked, r.taken_down,
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
  'The ONE writer of clone_watch_monthly_brand_stats + _registrar_stats (v319, columns extended v325). Atomic replace of a month, freezing it (frozen_at = now()). A frozen month is refused ({status:"frozen"}) unless p_republish, which restates it and re-stamps frozen_at ({status:"republished", previous_frozen_at}). Caller: clone-watch-report-summary.';

REVOKE ALL ON FUNCTION public.write_clone_watch_monthly_stats(date, jsonb, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_clone_watch_monthly_stats(date, jsonb, jsonb, boolean)
  TO service_role;

SELECT set_config('app.clone_watch_republish', 'off', true);

COMMIT;
