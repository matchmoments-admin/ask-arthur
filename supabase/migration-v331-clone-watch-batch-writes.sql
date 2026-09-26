-- v331 — clone-watch bookkeeping writes by the batch, not by the row (#1229 part 1)
--
-- WHY. Two clone-watch lanes wrote one row per round trip from inside an
-- Inngest step on a 5-slot Hobby account (ADR-0019):
--
--   * clone-watch-lifecycle-recheck's `mark-rechecked` step called
--     mark_clone_alert_rechecked(bigint) once per attempted id — up to 90
--     sequential RPCs per run, 4 runs/day, all latency inside a held slot.
--   * clone-watch-enrich-attribution ran one `enrich-${id}` step per alert
--     (60/run), each ending in its own UPDATE. #1229 folds those into ONE
--     bounded-concurrency step; this function is its write half, flushed in
--     small chunks so a killed step keeps what it already paid for.
--
-- WHAT. Two new SECURITY DEFINER functions. Nothing existing changes:
-- mark_clone_alert_rechecked(bigint) (v278) is kept for any caller still on
-- it, and for rollback.
--
--   mark_clone_alerts_rechecked(bigint[]) — the per-row body of v278, applied
--     to every id in the array in ONE statement: recheck_count + 1,
--     last_rechecked_at = now(), updated_at = now(), and NOTHING else (v278's
--     whole point: recheck bookkeeping must never name a lifecycle_state).
--     One difference, by construction: a duplicated id is bumped once, not
--     twice (`id = ANY`). The only caller passes distinct ids. Returns the
--     number of rows updated.
--
--   apply_clone_alert_attributions(jsonb) — writes the attribution dossier
--     (and, when supplied, campaign_key) for a batch of alerts:
--     [{ "id": 123, "attribution": {...}, "campaign_key": "abc" | null }, ...].
--     Same columns the old per-row `.update({attribution, campaign_key})`
--     wrote; updated_at is deliberately NOT touched, as before. A null or
--     missing campaign_key leaves the column alone (the old code omitted the
--     key when FF_CLONE_CAMPAIGNS was off). Writes ONLY rows whose attribution
--     IS NULL — the enricher's own worklist predicate — so a retried step can
--     never overwrite a dossier a previous attempt (or a kit pivot, which
--     merges into attribution) already wrote. Returns the number of rows
--     written; the caller reports the difference as already-enriched.
--     The clone_alert_platform_projection trigger (AFTER UPDATE OF
--     attribution) fires per row exactly as it did for the per-row UPDATE.
--
-- Both cap their input (500 ids / 500 rows) so a caller bug cannot turn one
-- call into an unbounded hot-table write, and carry a FUNCTION-LEVEL
-- statement_timeout (an in-body SET LOCAL is decorative under PostgREST —
-- supabase/CLAUDE.md §4).
--
-- Grants per v324 / supabase/CLAUDE.md §7: REVOKE from PUBLIC, anon,
-- authenticated; EXECUTE to service_role only.
--
-- Idempotent: CREATE OR REPLACE with fixed signatures; re-running is a no-op.
-- Rollback: DROP FUNCTION IF EXISTS both, and revert the two callers
-- (clone-watch-lifecycle-recheck.ts, clone-watch-enrich-attribution.ts) —
-- the old single-row path is still in the schema.
--
-- Deploy order: APPLY THIS BEFORE MERGING the code that calls it. A deploy
-- that reaches either function first gets PGRST202: the recheck lane throws
-- (and retries), the enricher counts every row as write_failed.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_clone_alerts_rechecked(
  p_alert_ids bigint[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
DECLARE
  n integer;
BEGIN
  IF p_alert_ids IS NULL OR pg_catalog.cardinality(p_alert_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF pg_catalog.cardinality(p_alert_ids) > 500 THEN
    RAISE EXCEPTION 'mark_clone_alerts_rechecked: % ids exceeds the 500 cap',
      pg_catalog.cardinality(p_alert_ids);
  END IF;

  UPDATE public.shopfront_clone_alerts
  SET recheck_count = recheck_count + 1,
      last_rechecked_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = ANY (p_alert_ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_clone_alerts_rechecked(bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_clone_alerts_rechecked(bigint[])
  TO service_role;

COMMENT ON FUNCTION public.mark_clone_alerts_rechecked(bigint[]) IS
  'Array form of mark_clone_alert_rechecked (v278): bumps recheck_count and '
  'last_rechecked_at for every id, touches NOTHING else, in one statement. '
  'Returns rows updated. Cap 500 ids. v331 / #1229.';

CREATE OR REPLACE FUNCTION public.apply_clone_alert_attributions(
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
DECLARE
  n integer;
BEGIN
  IF p_rows IS NULL
     OR pg_catalog.jsonb_typeof(p_rows) <> 'array'
     OR pg_catalog.jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;
  IF pg_catalog.jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'apply_clone_alert_attributions: % rows exceeds the 500 cap',
      pg_catalog.jsonb_array_length(p_rows);
  END IF;

  WITH src AS (
    SELECT DISTINCT ON ((e ->> 'id')::bigint)
      (e ->> 'id')::bigint AS id,
      e -> 'attribution' AS attribution,
      NULLIF(e ->> 'campaign_key', '') AS campaign_key
    FROM pg_catalog.jsonb_array_elements(p_rows) AS e
    WHERE e ? 'id'
      AND pg_catalog.jsonb_typeof(e -> 'attribution') = 'object'
  )
  UPDATE public.shopfront_clone_alerts AS a
  SET attribution = src.attribution,
      campaign_key = COALESCE(src.campaign_key, a.campaign_key)
  FROM src
  WHERE a.id = src.id
    AND a.attribution IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_clone_alert_attributions(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_clone_alert_attributions(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.apply_clone_alert_attributions(jsonb) IS
  'Batch write of clone-watch attribution dossiers (clone-watch-enrich-attribution): '
  '[{id, attribution, campaign_key?}] → sets attribution (+ campaign_key when non-null) '
  'ONLY where attribution IS NULL, so a retried step never overwrites. Returns rows '
  'written. Cap 500. v331 / #1229.';

COMMIT;
