-- migration-v314-netcraft-verdicts-and-preclassify-calibration.sql
--
-- Two instruments that stopped measuring. Both found by querying prod
-- (2026-09-22 end-to-end review), not by reading code.
--
-- ── 1. Netcraft's per-URL verdict was read every run and thrown away ────────
--
-- The reconciler (clone-watch-netcraft-reconcile.ts) fetches the per-URL
-- truth from GET /submission/{uuid}/urls and then keeps only a lifecycle
-- bucket. Two consequences, both live:
--
--   a. A `no threats` on a row WE witnessed weaponise is filed as "other" (the
--      v249 no-downgrade rule, correctly) — but the verdict itself is never
--      persisted. Sept: 29 weaponised, 7 reached malicious, and the other 22
--      are indistinguishable from "Netcraft hasn't looked yet". That
--      disagreement is the whole vendor-gap story.
--   b. takedown_at is stamped only on a WITNESSED transition (v219), with our
--      own now() as the clock. Since v284 we only submit weaponised sites, and
--      Netcraft grades those within minutes — so the reconciler's first look
--      (≈1.8 days later) already sees `malicious`, the witnessed rule refuses
--      to stamp, and the time-to-takedown KPI has had n=0 new rows for 30
--      days (6 malicious outcomes, 0 stamps).
--
-- Netcraft's /urls payload carries its OWN clock: a per-URL
-- `classification_log` [{date, from_state, to_state}] and a
-- `url_classification_reason` ("Already reported and rejected."). Using
-- Netcraft's timestamp is strictly more honest than v219's now()-at-first-look,
-- so the witnessed rule is not needed for it: a stamp from the vendor's log is
-- not a backfill guess. The one case it must refuse is a malicious date that
-- PRECEDES our submission — the site was already on Netcraft's list, the
-- "time to takedown" would be negative, and the report was not ours to be
-- credited for. That is recorded as `already_malicious_at_submit`.
--
-- The lower bound is the EARLIER of our submitted_at and Netcraft's own
-- receipt time (`netcraft_submitted_at`, the submission's `date`). Ours is
-- written after the POST returns, and Netcraft routinely classifies inside
-- that gap: the first draft of this migration compared against ours alone and
-- flagged 5 of 7 real takedowns "already malicious" when Netcraft's log dated
-- them 11-20 s AFTER it received them. The flag is recomputed on every call,
-- so a wrong one self-corrects.
--
-- record_netcraft_url_verdicts() is called BEFORE apply_netcraft_reconcile in
-- the same step, so the vendor timestamp wins and apply's v219/v249 now()-stamp
-- only fills the rows the log could not date. Signature of
-- apply_netcraft_reconcile is unchanged.
--
-- ── 2. clone_watch_jev_calibration() cannot see a live Jev row ──────────────
--
-- v313 put `WHERE h.model_id NOT LIKE 'jev%'` in the `shared` CTE that BOTH
-- sides of its UNION project from. In primary mode Jev writes the gate row
-- too, so every post-swap alert is dropped from BOTH curves (prod 2026-09-22:
-- 3,551 alerts carry both rows, the function reports 3,550). The function is
-- correct as what it now is — a frozen, pre-swap, same-population comparison —
-- and stays unchanged apart from its COMMENT.
--
-- The 30-day threshold revisit ADR-0026 commits to needs a different shape:
-- live rows have no Haiku counterpart to compare against. So a new
-- single-classifier curve over the GATE rows (clone_watch_classifications),
-- grouped by model_id rather than filtered on a vendor-controlled prefix — a
-- renamed model shows up as a new group instead of silently vanishing. Every
-- row is bucketed the same way (no is_clone=false → bucket 0 special case,
-- which v311/v312 applied to one side only).

BEGIN;

-- ── 1. record_netcraft_url_verdicts ─────────────────────────────────────────
-- p_verdicts: [{ "id": 123, "url_state": "no threats",
--               "reason": "Already reported and rejected." | null,
--               "malicious_at": "2026-09-22T13:03:57Z" | null,
--               "netcraft_submitted_at": "2026-09-22T13:03:46Z" | null }]
CREATE OR REPLACE FUNCTION public.record_netcraft_url_verdicts(p_verdicts jsonb)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  WITH v AS (
    SELECT
      (e ->> 'id')::bigint                         AS id,
      NULLIF(e ->> 'url_state', '')                AS url_state,
      NULLIF(e ->> 'reason', '')                   AS reason,
      NULLIF(e ->> 'malicious_at', '')::timestamptz AS malicious_at,
      NULLIF(e ->> 'netcraft_submitted_at', '')::timestamptz AS nc_submitted_at
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_verdicts, '[]'::jsonb)) e
    WHERE (e ->> 'id') IS NOT NULL
  ),
  calc AS (
    SELECT
      sca.id,
      v.url_state,
      v.reason,
      v.malicious_at,
      -- LEAST ignores NULLs: whichever clock we have, the earlier one wins.
      LEAST(
        (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz,
        v.nc_submitted_at
      )                                                                     AS submitted_at,
      (sca.submitted_to -> 'netcraft_issue' ->> 'issue_reported_at')::timestamptz AS issue_at,
      sca.submitted_to
    FROM public.shopfront_clone_alerts sca
    JOIN v ON v.id = sca.id
    WHERE sca.submitted_to ? 'netcraft'
  ),
  upd AS (
    UPDATE public.shopfront_clone_alerts sca
    SET submitted_to = (
      SELECT pg_catalog.jsonb_set(
        c.submitted_to,
        '{netcraft}',
        ((c.submitted_to -> 'netcraft') - 'already_malicious_at_submit')
          || pg_catalog.jsonb_build_object(
               'url_state',        c.url_state,
               'url_state_reason', c.reason,
               'url_state_at',     pg_catalog.now()::text
             )
          -- Vendor-dated takedown: first stamp only, never before our submission.
          || CASE
               WHEN c.malicious_at IS NOT NULL
                    AND c.submitted_at IS NOT NULL
                    AND c.malicious_at >= c.submitted_at
                    AND (c.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
               THEN pg_catalog.jsonb_build_object(
                      'takedown_at',        c.malicious_at::text,
                      'takedown_at_source', 'netcraft_log'
                    )
                    || CASE
                         WHEN c.issue_at IS NOT NULL AND c.malicious_at >= c.issue_at
                         THEN pg_catalog.jsonb_build_object('re_takedown_at', c.malicious_at::text)
                         ELSE '{}'::jsonb
                       END
               ELSE '{}'::jsonb
             END
          -- Already on Netcraft's list before we reported it: not our credit,
          -- and a negative duration must never reach the TTD KPI.
          || CASE
               WHEN c.malicious_at IS NOT NULL
                    AND c.submitted_at IS NOT NULL
                    AND c.malicious_at < c.submitted_at
               THEN pg_catalog.jsonb_build_object('already_malicious_at_submit', true)
               ELSE '{}'::jsonb
             END,
        true
      )
      FROM calc c WHERE c.id = sca.id
    ),
    updated_at = pg_catalog.now()
    WHERE sca.id IN (SELECT id FROM calc)
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_netcraft_url_verdicts(jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.record_netcraft_url_verdicts(jsonb) IS
  'v314. Persists Netcraft''s per-URL verdict (submitted_to.netcraft.url_state / url_state_reason / url_state_at) and, when Netcraft''s own classification_log dates the malicious transition at or after our submission, stamps takedown_at from that date (takedown_at_source=netcraft_log). A malicious date before our submission sets already_malicious_at_submit instead. Called before apply_netcraft_reconcile.';

-- ── 2a. Frozen pre-swap comparison — body unchanged, COMMENT corrected ─────
COMMENT ON FUNCTION public.clone_watch_jev_calibration() IS
  'FROZEN pre-swap Haiku-vs-Jev comparison (ADR-0026 day-1 decision): outcome counts per decile over alerts whose gate row Haiku wrote and which also carry a Jev shadow row. Sees NO post-swap alert by construction (v313). For live threshold review use clone_watch_preclassify_calibration() (v314).';

-- ── 2b. Live single-classifier calibration ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.clone_watch_preclassify_calibration(
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE (
  model_id          TEXT,
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
  SELECT
    c.model_id,
    LEAST(width_bucket(round(c.confidence::numeric, 6), 0, 1, 10), 10)::int AS bucket,
    count(*)::bigint,
    count(*) FILTER (WHERE a.urlscan_classification = 'likely_phishing')::bigint,
    count(*) FILTER (WHERE a.weaponised_at IS NOT NULL)::bigint,
    count(*) FILTER (WHERE a.netcraft_declined_at IS NOT NULL)::bigint,
    count(*) FILTER (WHERE a.triage_status = 'fp')::bigint,
    count(*) FILTER (WHERE a.triage_status = 'tp_actioned')::bigint
  FROM public.clone_watch_classifications c
  JOIN public.shopfront_clone_alerts a ON a.id = c.alert_id
  WHERE c.confidence IS NOT NULL
    AND (p_since IS NULL OR c.classified_at >= p_since)
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_preclassify_calibration(timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.clone_watch_preclassify_calibration(timestamptz) IS
  'v314. Calibration curve for whatever classifier WROTE the gate row (clone_watch_classifications.confidence), grouped by model_id: outcome counts per decile, bucket k = [(k-1)/10, k/10) with 1.0 in bucket 10, uniform for every row. The instrument for the ADR-0026 30-day threshold revisit. Outcomes (urlscan/weaponised/netcraft) mature over days — read recent cohorts with that lag in mind.';

COMMIT;
