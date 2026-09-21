-- v312: fix the decile edges in clone_watch_jev_calibration().
--
-- v311 bucketed with `width_bucket(p, 0, 1.0001, 10)` and documented bucket k
-- as [(k-1)/10, k/10). Two things made the labels wrong for exactly the
-- values the decision rule cares about: (1) the +0.0001 upper bound makes
-- every edge k*0.10001, not k/10; (2) `confidence` / `is_clone_p` are REAL,
-- and float32 rounds 0.9 to 0.89999997, 0.7 to 0.69999999 — so every exact
-- decile (the round numbers an LLM emits, and the Haiku gates: >= 0.7,
-- >= 0.9) landed ONE bucket below its documented interval. Shape of the
-- curve unaffected; labels shifted. Reviewed 2026-09-22.
--
-- Fix: round to numeric(…,6) first (kills the float32 artefact), bucket on
-- [0, 1] with exact edges, and LEAST(…, 10) so p = 1.0 stays in bucket 10
-- instead of the overflow bucket 11. Bucket k now covers [(k-1)/10, k/10)
-- with 1.0 folded into 10.

BEGIN;

CREATE OR REPLACE FUNCTION public.clone_watch_jev_calibration()
RETURNS TABLE (
  classifier        TEXT,
  bucket            INTEGER,
  n                 BIGINT,
  urlscan_phish     BIGINT,
  weaponised        BIGINT,
  netcraft_declined BIGINT,
  triaged_fp        BIGINT,
  tp_actioned       BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH shared AS (
    SELECT
      a.id,
      (a.urlscan_classification = 'likely_phishing')       AS is_phish,
      (a.weaponised_at IS NOT NULL)                        AS is_weaponised,
      (a.netcraft_declined_at IS NOT NULL)                 AS is_declined,
      (a.triage_status = 'fp')                             AS is_fp,
      (a.triage_status = 'tp_actioned')                    AS is_actioned,
      CASE
        WHEN h.is_clone THEN LEAST(width_bucket(round(h.confidence::numeric, 6), 0, 1, 10), 10)
        ELSE 0
      END                                                  AS haiku_bucket,
      LEAST(width_bucket(round(j.is_clone_p::numeric, 6), 0, 1, 10), 10) AS jev_bucket
    FROM public.shopfront_clone_alerts a
    JOIN public.clone_watch_classifications     h ON h.alert_id = a.id
    JOIN public.clone_watch_jev_classifications j ON j.alert_id = a.id
  ),
  both_sides AS (
    SELECT 'haiku'::text AS classifier, haiku_bucket AS bucket, is_phish, is_weaponised, is_declined, is_fp, is_actioned FROM shared
    UNION ALL
    SELECT 'jev'::text,   jev_bucket,                 is_phish, is_weaponised, is_declined, is_fp, is_actioned FROM shared
  )
  SELECT
    b.classifier,
    b.bucket,
    count(*)::bigint,
    count(*) FILTER (WHERE b.is_phish)::bigint,
    count(*) FILTER (WHERE b.is_weaponised)::bigint,
    count(*) FILTER (WHERE b.is_declined)::bigint,
    count(*) FILTER (WHERE b.is_fp)::bigint,
    count(*) FILTER (WHERE b.is_actioned)::bigint
  FROM both_sides b
  GROUP BY b.classifier, b.bucket
  ORDER BY b.classifier, b.bucket;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_jev_calibration()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.clone_watch_jev_calibration() IS
  'Haiku-vs-Jev calibration curves over the alerts both classifiers scored: outcome counts per probability decile, bucket k = [(k-1)/10, k/10) with 1.0 in bucket 10. v311; decile edges fixed v312.';

COMMIT;
