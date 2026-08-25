-- Migration v286 — two defects introduced by v285, found in review and
-- confirmed against prod before fixing.
--
-- ── 1. mark_stale_clone_alerts_dormant desynced alert_state ─────────────────
--
-- v285 gave `dormant` its first writer, but did it with a RAW UPDATE of
-- lifecycle_state. Every other lifecycle writer goes through
-- advance_clone_lifecycle (v199), whose stated purpose is:
--
--   "The two are kept consistent ONLY at terminal transitions (taken_down /
--    dormant), done in advance_clone_lifecycle() below, so existing
--    alert_state consumers stay correct."  (v199 header, lines 20-22)
--
-- It maps `dormant -> alert_state = 'expired'` (v199:197). The v285 sweep
-- skipped that, so a row it retires keeps `alert_state = 'open'` forever.
--
-- CONFIRMED IN PROD before writing this:
--   lifecycle_state | alert_state | n
--   dormant         | open        | 2     <-- wrong, both written by v285
--   taken_down      | taken_down  | 86    <-- correct, written via v199
--
-- Live consequence: aggregate_open_clone_alerts_by_brand (v198:99-114) has no
-- date or triage filter — it counts `alert_state='open'` — and feeds
-- brand_register.open_count rendered on /admin/brand-register. Every alert the
-- sweep retires would keep inflating that operator-facing per-brand count
-- indefinitely. This is exactly the double-bookkeeping v199 was written to
-- prevent, and exactly the house rule v272 states: a write path must move the
-- row across the predicate the next stage filters on, or leave it alone.
--
-- Fixed by stamping alert_state + updated_at in the same UPDATE (not by
-- switching to advance_clone_lifecycle, which is per-row and would turn a
-- bounded set-based sweep into up to 500 round trips).
--
-- ── 2. clone_watch_urlscan_stranded_count now overcounts ────────────────────
--
-- Its `stranded_streak` leg counts `urlscan_failure_streak >= max AND
-- urlscan_classification IS NULL` as "can never be urlscan-classified", and
-- /admin/clone-watch renders it under exactly that claim. v285 made that false
-- for one whole subgroup: rows whose failure was a 400 (no DNS) are now
-- explicitly re-admitted to the submit worklist regardless of streak.
--
-- Measured now: stranded_streak = 282, of which 269 are the 400/DNS shape that
-- v285 re-admits. The panel overstates its own bucket by ~95%, on the one
-- dashboard whose entire purpose (per v274's header) is honesty about this
-- cohort. v274 fixed a 75% overstatement here; v285 quietly reintroduced one.
--
-- Fixed by mirroring v285's carve-out: a 400 inside the 90-day submit horizon
-- is NOT stranded, because the lane will retry it on the dead-domain cadence.
-- A 400 PAST the horizon still is (until the dormant sweep retires it).
-- Rows already marked dormant are excluded from all four counts: deliberate,
-- recorded retirement is not the same as "stuck and we don't know it", and
-- conflating them would refill the panel with rows we consciously gave up on.
--
-- Idempotent. No table DDL. The repair UPDATE is a no-op once applied.

-- ── 1a. Repair the rows v285 already flipped ────────────────────────────────
UPDATE public.shopfront_clone_alerts
SET alert_state = 'expired',
    updated_at  = now()
WHERE lifecycle_state = 'dormant'
  AND alert_state <> 'expired';

-- ── 1b. Stop the sweep desyncing future rows ────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_stale_clone_alerts_dormant(
  p_horizon_days integer DEFAULT 90,
  p_min_confidence real DEFAULT 0.7,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    SELECT sca.id
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      AND sca.lifecycle_state = 'detected'
      AND sca.urlscan_uuid IS NULL
      AND sca.urlscan_classification IS NULL
      AND sca.first_seen_at
          < now() - make_interval(days => GREATEST(1, p_horizon_days))
      AND EXISTS (
        SELECT 1
        FROM public.clone_watch_classifications c
        WHERE c.alert_id = sca.id
          AND c.is_clone
          AND c.confidence >= p_min_confidence
      )
    ORDER BY sca.first_seen_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 2000))
  )
  UPDATE public.shopfront_clone_alerts t
  SET lifecycle_state = 'dormant',
      -- v286: keep the COARSE disposition in sync, exactly as
      -- advance_clone_lifecycle (v199:195-198) does for terminal states.
      -- Without this the row stays alert_state='open' and keeps inflating
      -- aggregate_open_clone_alerts_by_brand on /admin/brand-register.
      alert_state = 'expired',
      updated_at = now()
  FROM stale
  WHERE t.id = stale.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_stale_clone_alerts_dormant(integer, real, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_clone_alerts_dormant(integer, real, integer)
  TO service_role;

COMMENT ON FUNCTION public.mark_stale_clone_alerts_dormant(integer, real, integer) IS
  'v285/v286: retires high-confidence alerts that aged past the urlscan submit horizon while still unscanned. Sole writer of lifecycle_state=dormant, and stamps alert_state=expired to match advance_clone_lifecycle''s terminal-state contract (v199).';

-- ── 2. Stranded count stops claiming re-admitted rows are stuck ─────────────
-- Signature and row type unchanged, so a plain CREATE OR REPLACE is safe (v274
-- needed a DROP because it ADDED OUT columns; changing only the body does not).
CREATE OR REPLACE FUNCTION public.clone_watch_urlscan_stranded_count(
  p_max_failure_streak integer DEFAULT 3
)
RETURNS TABLE (
  stranded_total bigint,
  stranded_streak bigint,
  stranded_submitted_no_uuid bigint,
  stranded_uuid_no_submitted_at bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH scoped AS (
    SELECT
      sca.*,
      -- v286: v285 re-admits a 400 (no DNS) inside the submit horizon
      -- regardless of streak, so such a row is NOT stranded — the lane retries
      -- it on the dead-domain cadence. Past the horizon it is stranded again,
      -- until the dormant sweep records that we gave up.
      (sca.urlscan_failure_streak >= p_max_failure_streak
        AND sca.urlscan_classification IS NULL
        AND NOT (
          sca.urlscan_evidence ->> 'status' = '400'
          AND sca.first_seen_at >= now() - interval '90 days'
        )) AS is_streak_frozen,
      (sca.urlscan_submitted_at IS NOT NULL
        AND sca.urlscan_uuid IS NULL
        AND sca.urlscan_scanned_at IS NULL) AS is_submitted_no_uuid,
      (sca.urlscan_uuid IS NOT NULL
        AND sca.urlscan_submitted_at IS NULL
        AND sca.urlscan_classification IS NULL) AS is_uuid_no_submitted_at
    FROM public.shopfront_clone_alerts sca
    WHERE sca.source = 'nrd'
      -- Deliberate, recorded retirement is not "stuck and we don't know it".
      AND sca.lifecycle_state <> 'dormant'
  )
  SELECT
    -- The union. Render THIS; the three below are an overlapping breakdown.
    count(*) FILTER (
      WHERE s.is_streak_frozen
         OR s.is_submitted_no_uuid
         OR s.is_uuid_no_submitted_at
    ),
    count(*) FILTER (WHERE s.is_streak_frozen),
    count(*) FILTER (WHERE s.is_submitted_no_uuid),
    count(*) FILTER (WHERE s.is_uuid_no_submitted_at)
  FROM scoped s;
$function$;

REVOKE ALL ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_urlscan_stranded_count(integer)
  TO service_role;

COMMENT ON FUNCTION public.clone_watch_urlscan_stranded_count(integer) IS
  'Clone-watch alerts that no automated lane will retry, as a UNION (v274) plus an overlapping three-way breakdown. The three shapes overlap heavily — never sum them; render stranded_total. v286: a 400 (no DNS) inside the 90-day submit horizon is no longer counted as frozen, because v285 re-admits it; rows already retired as dormant are excluded entirely.';
