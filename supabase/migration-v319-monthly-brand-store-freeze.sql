-- migration-v319-monthly-brand-store-freeze.sql
--
-- One monthly per-brand store (clone-watch deepening plan, PR 7; ADR-0020
-- amendment 2026-09-23).
--
-- ── What was wrong (all measured in prod 2026-09-23, not read from code) ─────
--
-- 1. TWO producers of one fact. `clone-watch-report-summary` (cron 0 11 1 * *)
--    wrote per-brand monthly counts here, keyed on the brand's primary DOMAIN;
--    `report-brand-stewardship` (cron 0 9 1 * *, i.e. two hours EARLIER)
--    re-fetched the same month of shopfront_clone_alerts and refolded the same
--    counts into brand_stewardship_reports.metrics.clones. Two folds, two
--    clocks, one number printed in two places.
--
-- 2. Published months were rewritten. writeTrendRows was delete-then-insert of
--    the whole month on every run, so any re-run (a backfill, a retry, a
--    methodology change) silently restated months that had already been
--    published: June, July and August were all rewritten on 2026-09-04. The
--    delete and the insert were also two separate PostgREST calls — a failure
--    between them lost the month outright.
--
-- 3. `weaponised` is the CURRENT state at snapshot time, not "was ever
--    weaponised": a clone that weaponised and was then taken down leaves the
--    column. Correct for what it is, and not what a reader of "weaponised this
--    month" assumes.
--
-- 4. Takedowns are credited to the month the lookalike was FIRST SEEN, not the
--    month the takedown happened. July's row said 48 taken down; 11 takedowns
--    were actually dated inside July (submitted_to.netcraft.takedown_at, the
--    witnessed/vendor-dated stamp v219/v314 maintain), 6 of them on lookalikes
--    first seen in an earlier month.
--
-- ── What this migration does ─────────────────────────────────────────────────
--
-- Additive columns on clone_watch_monthly_brand_stats:
--   brand_normalized          the Canonical Brand key (ADR-0020) for the row's
--                             domain — the promotion the 2026-09-03 amendment
--                             named and deferred. The grain stays the DOMAIN
--                             (PK unchanged): re-keying frozen editions would be
--                             a restatement, which is exactly what this
--                             migration exists to stop.
--   weaponised_ever           cohort members with weaponised_at set (ever, as of
--                             the freeze) — the monotone sibling of `weaponised`.
--   weaponised_after_decline  } were computed by the stewardship refold and
--   re_taken_down             } never stored; the store now carries every count
--                             the stewardship ledger prints.
--   taken_down_in_month       EVENT-dated: distinct lookalikes of this brand
--                             whose takedown_at falls inside the month,
--                             regardless of first-seen month. Undated takedowns
--                             (68 of 91 in prod — the pre-v314 witnessed rule
--                             refused to stamp them) cannot be event-dated and
--                             are NOT counted here; they remain in the cohort
--                             `taken_down`. Attached only to brands with a row
--                             that month (≥1 detection); 1 dated takedown in
--                             Jul–Aug belonged to a brand with none.
--   alert_ids                 the cohort MEMBERSHIP behind this row (per-brand
--                             deduped, first alert id per candidate domain). The
--                             stewardship ledger reads these ids for its
--                             per-lookalike watch-list instead of re-deriving
--                             "who counts" from the alert table.
--   frozen_at                 when this month was published. NOT NULL = frozen.
--
-- write_clone_watch_monthly_stats(): the ONE writer. Atomic (delete + insert of
-- brand AND registrar rows in one transaction, fixing the lost-month window),
-- serialised per month by an advisory lock, and it REFUSES a frozen month
-- unless p_republish => true — which re-stamps frozen_at, so a deliberate
-- restatement is visible as such.
--
-- A BEFORE trigger on the brand table makes the freeze hold for writers that
-- bypass the RPC (the old TS delete-then-insert, an ad-hoc script): UPDATE /
-- DELETE of a frozen row, or INSERT into a frozen month, raises. The RPC (and
-- this migration's own backfill) lift it transaction-locally via the
-- `app.clone_watch_republish` setting. This is an INTENT guard against
-- accidental restatement, not an access control — service_role could set the
-- same GUC; nothing else can write this table at all (v193 deny-all RLS).
--
-- Backfill of the three published months (Jun/Jul/Aug 2026): the NEW columns
-- are computed from live data at migration time; the v193–v296 columns are not
-- touched. frozen_at is the month's clone_watch_report_summary.generated_at
-- (when those numbers were last computed — 2026-09-04 for all three), else
-- now(). Re-applying changes nothing (every backfill is WHERE … IS NULL).
--
-- Cold table (~150 rows/month), no hot-table rules apply; the function carries a
-- function-level statement_timeout (supabase/CLAUDE.md §4 — SET LOCAL inside the
-- body would be decorative under PostgREST's 8 s authenticator cap).
--
-- Rollback: DROP TRIGGER clone_watch_brand_stats_freeze_guard ON
-- clone_watch_monthly_brand_stats; DROP FUNCTION
-- write_clone_watch_monthly_stats(date, jsonb, jsonb, boolean),
-- clone_watch_brand_stats_freeze_guard(); the columns are additive and may stay
-- (the pre-v319 writer ignores them).

BEGIN;

-- Lift the freeze guard for this transaction only (re-apply safety: on a
-- second run the trigger below already exists and would otherwise refuse the
-- backfill UPDATEs against frozen rows — which are no-ops anyway).
SELECT set_config('app.clone_watch_republish', 'on', true);

ALTER TABLE public.clone_watch_monthly_brand_stats
  ADD COLUMN IF NOT EXISTS brand_normalized         text,
  ADD COLUMN IF NOT EXISTS weaponised_ever          integer,
  ADD COLUMN IF NOT EXISTS weaponised_after_decline integer,
  ADD COLUMN IF NOT EXISTS re_taken_down            integer,
  ADD COLUMN IF NOT EXISTS taken_down_in_month      integer,
  ADD COLUMN IF NOT EXISTS alert_ids                bigint[],
  ADD COLUMN IF NOT EXISTS frozen_at                timestamptz;

COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.brand IS
  'The brand''s PRIMARY DOMAIN (watchlist legitimate_domains[0], via shopfront_clone_alerts.inferred_target_domain) — the row grain and the join key to known_brands.brand_domain. For the Canonical Brand key use brand_normalized (v319).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.brand_normalized IS
  'Canonical Brand key (brand_normalize, ADR-0020) of the domain''s owning brand; joins to shopfront_clone_alerts.target_brand_normalized and brand_coverage_history.brand_normalized. Rule (TS twin monthly-brand-store.ts brandKeyForDomain): the single coverage-history mapping for the domain; else the candidate equal to the domain''s first label; else the most frequent alert key (ties alphabetical); else the first label. A domain shared by several brands (servicesaustralia.gov.au: Services Australia / Medicare / Centrelink) is ONE row keyed to its owner — the grain is still the domain (v319).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.weaponised IS
  'Cohort members CURRENTLY weaponised at snapshot time (a later takedown removes them). For "ever weaponised" read weaponised_ever (v319).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.taken_down IS
  'Cohort members (FIRST SEEN this month) currently taken_down at snapshot time — dated or not. Credits a takedown to the first-seen month. For takedowns that HAPPENED this month read taken_down_in_month (v319).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.weaponised_ever IS
  'Cohort members with weaponised_at set (first-touch, never cleared) as of frozen_at. Monotone sibling of `weaponised` (v319).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.taken_down_in_month IS
  'EVENT-dated: distinct lookalikes of this brand (any first-seen month) whose submitted_to.netcraft.takedown_at falls inside period_month. Undated takedowns are excluded (they stay in `taken_down`). NULL = not measured (v319).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.alert_ids IS
  'Cohort membership: the shopfront_clone_alerts ids this row counts (first id per candidate domain, per brand). Read by report-brand-stewardship for the per-lookalike watch-list so it never re-derives membership (v319).';
COMMENT ON COLUMN public.clone_watch_monthly_brand_stats.frozen_at IS
  'When this month was published. NOT NULL = frozen: write_clone_watch_monthly_stats refuses the month unless p_republish, which re-stamps this column; the freeze-guard trigger refuses direct writes (v319).';

-- ── Backfill: brand_normalized ──────────────────────────────────────────────
WITH cov AS (
  SELECT lower(btrim(brand_domain)) AS domain, brand_normalized AS bn
  FROM public.brand_coverage_history
  WHERE brand_domain IS NOT NULL AND brand_normalized IS NOT NULL
  GROUP BY 1, 2
), cov_single AS (
  SELECT domain, min(bn) AS bn FROM cov GROUP BY domain HAVING count(*) = 1
), alert_keys AS (
  SELECT s.period_month, s.brand, a.target_brand_normalized AS bn, count(*) AS n
  FROM public.clone_watch_monthly_brand_stats s
  JOIN public.shopfront_clone_alerts a
    ON lower(btrim(a.inferred_target_domain)) = s.brand
   AND a.source = 'nrd'
   AND a.first_seen_at >= s.period_month
   AND a.first_seen_at <  s.period_month + interval '1 month'
   AND a.target_brand_normalized IS NOT NULL
  WHERE s.brand_normalized IS NULL
  GROUP BY 1, 2, 3
), pool AS (
  SELECT period_month, brand, bn, n FROM alert_keys
  UNION ALL
  SELECT s.period_month, s.brand, c.bn, 0
  FROM public.clone_watch_monthly_brand_stats s
  JOIN cov c ON c.domain = s.brand
  WHERE s.brand_normalized IS NULL
), ranked AS (
  SELECT period_month, brand, bn,
         row_number() OVER (
           PARTITION BY period_month, brand
           ORDER BY (bn = public.brand_normalize(split_part(brand, '.', 1))) DESC,
                    sum(n) DESC,
                    bn ASC
         ) AS rn
  FROM pool
  GROUP BY period_month, brand, bn
)
UPDATE public.clone_watch_monthly_brand_stats s
SET brand_normalized = COALESCE(
  cs.bn,
  r.bn,
  public.brand_normalize(split_part(s.brand, '.', 1))
)
FROM public.clone_watch_monthly_brand_stats s2
LEFT JOIN cov_single cs ON cs.domain = s2.brand
LEFT JOIN ranked r
  ON r.period_month = s2.period_month AND r.brand = s2.brand AND r.rn = 1
WHERE s.period_month = s2.period_month
  AND s.brand = s2.brand
  AND s.brand_normalized IS NULL;

-- ── Backfill: membership + the counts the stewardship refold computed ───────
-- Members = the report card's cohort: source nrd, first seen in the month,
-- inferred_target_domain = the row's brand, not triaged fp. (The fp-brand
-- denylist is a TS list; a denylisted brand has no row, so the join drops it.)
-- Per-brand dedupe keeps the FIRST alert id per candidate domain, which is the
-- row aggregateClonesByDomain evaluates (it iterates in id order).
WITH members AS (
  SELECT DISTINCT ON (s.period_month, s.brand, a.candidate_domain)
         s.period_month, s.brand, a.id, a.weaponised_at, a.lifecycle_state,
         a.netcraft_declined_at, a.submitted_to
  FROM public.clone_watch_monthly_brand_stats s
  JOIN public.shopfront_clone_alerts a
    ON lower(btrim(a.inferred_target_domain)) = s.brand
   AND a.source = 'nrd'
   AND a.first_seen_at >= s.period_month
   AND a.first_seen_at <  s.period_month + interval '1 month'
   AND a.candidate_domain IS NOT NULL
   AND (a.triage_status IS NULL OR a.triage_status <> 'fp')
  WHERE s.alert_ids IS NULL
  ORDER BY s.period_month, s.brand, a.candidate_domain, a.id
), agg AS (
  SELECT period_month, brand,
         array_agg(id ORDER BY id) AS ids,
         count(*) FILTER (WHERE weaponised_at IS NOT NULL) AS w_ever,
         count(*) FILTER (WHERE lifecycle_state = 'weaponised'
                            AND netcraft_declined_at IS NOT NULL) AS w_after_decline,
         count(*) FILTER (WHERE lifecycle_state = 'taken_down'
                            AND (submitted_to -> 'netcraft_issue' ->> 'issue_reported_at') IS NOT NULL) AS re_td
  FROM members
  GROUP BY period_month, brand
)
UPDATE public.clone_watch_monthly_brand_stats s
SET alert_ids                = COALESCE(s.alert_ids, agg.ids),
    weaponised_ever          = COALESCE(s.weaponised_ever, agg.w_ever),
    weaponised_after_decline = COALESCE(s.weaponised_after_decline, agg.w_after_decline),
    re_taken_down            = COALESCE(s.re_taken_down, agg.re_td)
FROM agg
WHERE s.period_month = agg.period_month AND s.brand = agg.brand
  AND s.alert_ids IS NULL;

-- ── Backfill: event-dated takedowns ─────────────────────────────────────────
WITH dated AS (
  SELECT lower(btrim(a.inferred_target_domain)) AS brand,
         a.candidate_domain,
         (a.submitted_to -> 'netcraft' ->> 'takedown_at')::timestamptz AS takedown_at
  FROM public.shopfront_clone_alerts a
  WHERE a.source = 'nrd'
    AND a.inferred_target_domain IS NOT NULL
    AND (a.submitted_to -> 'netcraft' ->> 'takedown_at') IS NOT NULL
    AND (a.triage_status IS NULL OR a.triage_status <> 'fp')
), per_month AS (
  SELECT s.period_month, s.brand, count(DISTINCT d.candidate_domain) AS n
  FROM public.clone_watch_monthly_brand_stats s
  LEFT JOIN dated d
    ON d.brand = s.brand
   AND d.takedown_at >= s.period_month
   AND d.takedown_at <  s.period_month + interval '1 month'
  WHERE s.taken_down_in_month IS NULL
  GROUP BY s.period_month, s.brand
)
UPDATE public.clone_watch_monthly_brand_stats s
SET taken_down_in_month = per_month.n
FROM per_month
WHERE s.period_month = per_month.period_month AND s.brand = per_month.brand
  AND s.taken_down_in_month IS NULL;

-- ── Freeze every month already written (they are published editions) ──────
UPDATE public.clone_watch_monthly_brand_stats s
SET frozen_at = COALESCE(
  (SELECT r.generated_at FROM public.clone_watch_report_summary r
    WHERE r.period_month = s.period_month),
  now()
)
WHERE s.frozen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cw_brand_stats_brand_normalized
  ON public.clone_watch_monthly_brand_stats (brand_normalized, period_month DESC);

-- ── The freeze guard ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clone_watch_brand_stats_freeze_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(current_setting('app.clone_watch_republish', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION
      'clone_watch_monthly_brand_stats: % of a frozen month (% published %) — re-publish deliberately via write_clone_watch_monthly_stats(p_republish => true)',
      TG_OP, OLD.period_month, OLD.frozen_at
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.clone_watch_monthly_brand_stats s
    WHERE s.period_month = NEW.period_month AND s.frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'clone_watch_monthly_brand_stats: INSERT into frozen month % — re-publish deliberately via write_clone_watch_monthly_stats(p_republish => true)',
      NEW.period_month
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS clone_watch_brand_stats_freeze_guard
  ON public.clone_watch_monthly_brand_stats;
CREATE TRIGGER clone_watch_brand_stats_freeze_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.clone_watch_monthly_brand_stats
  FOR EACH ROW EXECUTE FUNCTION public.clone_watch_brand_stats_freeze_guard();

-- ── The one writer ──────────────────────────────────────────────────────────
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

  -- Serialise writers of the same month; the freeze check happens under it.
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
    frozen_at
  )
  SELECT
    p_period_month, r.brand, r.brand_normalized, COALESCE(r.is_au, false),
    r.clones, r.reported_to_netcraft, r.likely_phishing, r.parked, r.taken_down,
    r.declined, r.escalated, r.weaponised, r.deliberate_clones, r.tactic_mix,
    r.intent_mix, r.tld_mix, r.hosting_mix, r.clusters, r.fingerprinted_clones,
    r.largest_cluster, r.weaponised_ever, r.weaponised_after_decline,
    r.re_taken_down, r.taken_down_in_month, r.alert_ids,
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
  'The ONE writer of clone_watch_monthly_brand_stats + _registrar_stats (v319). Atomic replace of a month, freezing it (frozen_at = now()). A frozen month is refused ({status:"frozen"}) unless p_republish, which restates it and re-stamps frozen_at ({status:"republished", previous_frozen_at}). Caller: clone-watch-report-summary.';

REVOKE ALL ON FUNCTION public.write_clone_watch_monthly_stats(date, jsonb, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_clone_watch_monthly_stats(date, jsonb, jsonb, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.clone_watch_brand_stats_freeze_guard()
  FROM PUBLIC, anon, authenticated;

SELECT set_config('app.clone_watch_republish', 'off', true);

COMMIT;
