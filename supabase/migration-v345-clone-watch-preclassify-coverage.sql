-- v345 — Pre-classifier coverage: failures are stamped, the worklist is
-- oldest-first, and its demand is measurable (#1300, map #1294).
--
-- MEASURED (prod, read-only, 2026-10-13):
--   - NRD alerts needing classification: p50 31/day, p90 41, p95 47.8,
--     max 70 (2026-07-23) over the last 90 days. The fan-out asked for 50.
--   - 2026-10-06 had 53 → the cap bound: 3 alerts waited a day (Oct 7's
--     batches carried 23 for 20 new). It has bound on 4 days ever (70, 55,
--     55, 53). Nothing recorded it.
--   - 4,094 NRD alerts lifetime, 0 never classified, 0 aged out. The 14-day
--     horizon has never cost a classification — because demand sat under the
--     cap, not because anything would have noticed.
--   - Classify failures: 3 `_error` rows in 60 days; every batch row since
--     2026-09-24 has failed=0, unreached=0.
--   - Jev: $0.000048 per classification (544 calls, $0.0259 / 30 days);
--     the Haiku rollback is $0.002478 (52x). Peak clone-watch outreach spend
--     in 14 days: $0.0024/day against the $5/day brake.
--
-- WHAT
-- 1. clone_watch_preclassify_failures — one row per alert the classifier
--    threw on: attempts (one per UTC day — a step replay the same day does
--    not count twice), first/last failure, last error. A 1:1 sibling of
--    shopfront_clone_alerts (ADR-0005), not new columns on it: only the rare
--    failing alert gets a row, and the alerts table takes no new writes.
-- 2. list_clone_alerts_pending_preclassify — same signature, same columns
--    (CREATE OR REPLACE; deploy-window-safe both ways):
--      - excludes alerts with attempts >= 3 (GIVEN UP). Without this a
--        poison alert re-presents every day for 14 days (worklist-gate
--        starvation rule — with the oldest-first order below it would sit
--        at the HEAD);
--      - ORDER BY attempts ASC, first_seen_at ASC: never-tried before
--        retried, oldest before newest. Newest-first meant that whenever the
--        cap bound, the alerts it starved were exactly the ones closest to
--        the 14-day edge (the enricher's #1246 fix, applied here);
--      - the HARD CAP stays 100 (v159's cost rule). The caller now asks for
--        100: 1.4x the largest day ever seen. Cost at the full cap: Jev
--        $0.0048/day; Haiku rollback $0.25/day — both far inside $5/day.
-- 3. clone_watch_preclassify_coverage() — one row, always (even when the
--    worklist is empty): due_total (what the selector would return without
--    its LIMIT), gave_up_total / gave_up_24h, aged_out_total (unclassified
--    alerts past the horizon, lifetime). The fan-out writes these onto the
--    NRD ingest's Outcome Row so `cap_bound` can judge the cap against its
--    demand.
-- 4. record_clone_watch_preclassify_failures(jsonb) — the stamp.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, re-runnable.
-- Reverse: re-run migration-v159's function body; DROP the two new functions
-- and the table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.clone_watch_preclassify_failures (
  alert_id         bigint PRIMARY KEY
                   REFERENCES public.shopfront_clone_alerts (id) ON DELETE CASCADE,
  attempts         integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  first_failed_at  timestamptz NOT NULL DEFAULT now(),
  last_failed_at   timestamptz NOT NULL DEFAULT now(),
  last_error       text
);

ALTER TABLE public.clone_watch_preclassify_failures ENABLE ROW LEVEL SECURITY;
-- Server-only (service_role keeps its default privileges; v324 gives anon /
-- authenticated nothing). No policy: no user-scoped reader exists.

COMMENT ON TABLE public.clone_watch_preclassify_failures IS
  'v345 (#1300): pre-classifier failure stamp. One row per alert the classifier threw on; attempts counts UTC days with a failure. list_clone_alerts_pending_preclassify skips attempts >= 3 (given up).';

-- The selector. Same signature + columns as v159.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_preclassify(
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  inferred_target_domain text,
  candidate_domain text,
  candidate_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '30s'
STABLE
AS $$
  SELECT
    sca.id,
    sca.inferred_target_domain,
    sca.candidate_domain,
    sca.candidate_url
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN public.clone_watch_preclassify_failures f ON f.alert_id = sca.id
  WHERE sca.source = 'nrd'
    AND cwc.alert_id IS NULL                            -- not yet classified
    AND sca.inferred_target_domain IS NOT NULL          -- need a brand for the classifier
    AND sca.first_seen_at >= now() - interval '14 days' -- horizon
    AND COALESCE(f.attempts, 0) < 3                     -- given up after 3 failed days
  ORDER BY COALESCE(f.attempts, 0) ASC, sca.first_seen_at ASC, sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));               -- HARD CAP — load-bearing cost guard
$$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_pending_preclassify(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_preclassify(int)
  TO service_role;

COMMENT ON FUNCTION public.list_clone_alerts_pending_preclassify(int) IS
  'Classification-absence selector for the pre-classifier fan-out (#509). v345 (#1300): oldest-first, never-tried before retried, skips alerts given up after 3 failed days. LIMIT is a hard cost cap (<=100).';

-- Coverage: one row, always.
CREATE OR REPLACE FUNCTION public.clone_watch_preclassify_coverage()
RETURNS TABLE (
  due_total bigint,
  gave_up_total bigint,
  gave_up_24h bigint,
  aged_out_total bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '30s'
STABLE
AS $$
  WITH pool AS (
    SELECT
      sca.first_seen_at >= now() - interval '14 days' AS in_horizon,
      COALESCE(f.attempts, 0) AS attempts,
      f.last_failed_at
    FROM public.shopfront_clone_alerts sca
    LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
    LEFT JOIN public.clone_watch_preclassify_failures f ON f.alert_id = sca.id
    WHERE sca.source = 'nrd'
      AND cwc.alert_id IS NULL
      AND sca.inferred_target_domain IS NOT NULL
  )
  SELECT
    count(*) FILTER (WHERE in_horizon AND attempts < 3),
    count(*) FILTER (WHERE in_horizon AND attempts >= 3),
    count(*) FILTER (WHERE in_horizon AND attempts >= 3
                       AND last_failed_at >= now() - interval '24 hours'),
    count(*) FILTER (WHERE NOT in_horizon)
  FROM pool;
$$;

REVOKE ALL ON FUNCTION public.clone_watch_preclassify_coverage()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_watch_preclassify_coverage()
  TO service_role;

COMMENT ON FUNCTION public.clone_watch_preclassify_coverage() IS
  'v345 (#1300): pre-classifier demand for the NRD ingest Outcome Row. due_total = worklist size before its LIMIT; gave_up_* = unclassified alerts with 3 failed days (24h = given up today); aged_out_total = unclassified alerts past the 14-day horizon, lifetime.';

-- The stamp. p_failures: [{"alert_id": 123, "error": "..."}]. One attempt per
-- UTC day: a second failure the same day (a step retry/replay) refreshes the
-- error but does not count again. Unknown alert ids are skipped (the FK would
-- otherwise fail the whole batch). Returns rows written.
CREATE OR REPLACE FUNCTION public.record_clone_watch_preclassify_failures(
  p_failures jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '30s'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_failures IS NULL OR jsonb_typeof(p_failures) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.clone_watch_preclassify_failures AS t
    (alert_id, attempts, first_failed_at, last_failed_at, last_error)
  SELECT DISTINCT ON (x.alert_id)
    x.alert_id, 1, now(), now(), left(x.error, 300)
  FROM (
    SELECT (e->>'alert_id')::bigint AS alert_id, e->>'error' AS error
    FROM jsonb_array_elements(p_failures) e
    WHERE (e->>'alert_id') ~ '^[0-9]+$'
  ) x
  JOIN public.shopfront_clone_alerts sca ON sca.id = x.alert_id
  ORDER BY x.alert_id
  ON CONFLICT (alert_id) DO UPDATE SET
    attempts = t.attempts + CASE
      WHEN (t.last_failed_at AT TIME ZONE 'UTC')::date
           < (now() AT TIME ZONE 'UTC')::date THEN 1 ELSE 0 END,
    last_failed_at = now(),
    last_error = EXCLUDED.last_error;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_clone_watch_preclassify_failures(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_clone_watch_preclassify_failures(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.record_clone_watch_preclassify_failures(jsonb) IS
  'v345 (#1300): stamp pre-classifier failures ([{alert_id, error}]). attempts counts UTC days; a same-day repeat refreshes last_error only.';

COMMIT;
