-- v279 — stop spending first-scan submits on domains urlscan has already refused.
--
-- v277 gave `list_clone_alerts_for_recheck` a long cadence for rows urlscan
-- rejected with HTTP 400 (its no-DNS response). The sibling submit worklist never
-- got the same treatment.
--
-- SCOPE — read this before assuming the effect is larger than it is. My first
-- reading of the live worklist was "28 of 30 rows are already-400-rejected, so the
-- lane is 90% wasted and fresh candidates are starving." That was WRONG, and the
-- error is worth recording because the query looked damning:
--
--   * The worklist is `ORDER BY sca.first_seen_at DESC`. Fresh candidates sort
--     FIRST; dead-domain rows only ever occupy slots the fresh ones did not need.
--   * I sampled at 03:15 UTC — between the 08:30 NRD ingest and the 09:00 submit —
--     so "28 of 30 are dead" meant "only 2 recent candidates remain unscanned right
--     now", not "fresh work is being crowded out".
--
-- Measured properly, per ingest day (gate-passing -> actually scanned):
--   2026-08-09  25 -> 24     2026-08-08  23 -> 16
--   2026-08-07  33 -> 30     2026-08-06  29 -> 23
-- ~80% of fresh candidates are scanned. The lane was not starved.
--
-- So this migration is a QUOTA and CHURN fix, not a throughput fix. What it
-- actually buys: 125 rows with a 400 stamp and streak < 3 are currently recycled
-- through the batch as padding, costing ~10-25 urlscan submits a day on domains
-- known not to resolve, and driving streak churn on rows nothing can classify.
-- Deferring them to a 168h cadence removes that spend. It does NOT increase the
-- number of fresh candidates scanned, because nothing was displacing them.
--
-- Corollary worth carrying forward: the ~20% of each cohort that is never scanned
-- is mostly domains urlscan REFUSES because they have no DNS — not candidates
-- starved of capacity. More slots would not recover them. What they lack is a
-- terminal state, which we deliberately did not add: 22 of the 400-rejected rows
-- were confirmed real threats and actioned by Netcraft, so "400 means nothing to
-- see" is false, and backfilling a classification would also have cut a published
-- headline by 17.9% (see the v276 notes).
--
-- Deliberately a cadence and NOT an exclusion, same as v277: a 400 is not
-- permanent (8 of the 326 rows that once 400'd later acquired a uuid and
-- classified). A row is skipped only while its LAST attempt is recent.
--
-- Keyed on `urlscan_evidence->>'attempted_at'`, which serialiseSubmitFailure has
-- always written — verified present on 125/125 affected rows. Self-correcting: a
-- successful submit replaces urlscan_evidence wholesale, dropping the 400 stamp.
--
-- Signature change: adds p_dead_cadence_hours. DROP first — adding a parameter
-- creates an overload rather than replacing the function, and the existing
-- three-argument caller (clone-watch-urlscan-submit.ts) would then fail to
-- resolve. The default keeps that call site working unchanged.

DROP FUNCTION IF EXISTS public.list_clone_alerts_pending_urlscan_submit(integer, real, integer);

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_urlscan_submit(
  p_limit integer DEFAULT 30,
  p_min_confidence real DEFAULT 0.7,
  p_max_failure_streak integer DEFAULT 3,
  p_dead_cadence_hours integer DEFAULT 168
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain
  FROM public.shopfront_clone_alerts sca
  WHERE sca.source = 'nrd'
    AND sca.urlscan_uuid IS NULL
    AND sca.urlscan_failure_streak < p_max_failure_streak
    AND sca.first_seen_at >= now() - interval '14 days'
    -- v279: a domain urlscan refused with a 400 (no DNS) waits out a long
    -- cadence before it is offered a slot again. Not an exclusion — a 400 is not
    -- permanent, and the row returns on its own once the cadence lapses. These
    -- rows were padding the tail of the batch (the ORDER BY puts fresh candidates
    -- first), so this saves quota rather than unblocking fresh work.
    AND (
      sca.urlscan_evidence ->> 'status' IS DISTINCT FROM '400'
      OR sca.urlscan_evidence ->> 'attempted_at' IS NULL
      OR (sca.urlscan_evidence ->> 'attempted_at')::timestamptz
         < now() - make_interval(hours => GREATEST(1, p_dead_cadence_hours))
    )
    AND EXISTS (
      SELECT 1
      FROM public.clone_watch_classifications c
      WHERE c.alert_id = sca.id
        AND c.is_clone
        AND c.confidence >= p_min_confidence
    )
  ORDER BY sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

REVOKE ALL ON FUNCTION public.list_clone_alerts_pending_urlscan_submit(integer, real, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_urlscan_submit(integer, real, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_clone_alerts_pending_urlscan_submit(integer, real, integer, integer) IS
  'Gated first-scan worklist. Rows whose last urlscan submit was refused with '
  'HTTP 400 (no DNS) wait p_dead_cadence_hours before being offered a slot again '
  '(v279). This is a QUOTA fix, not a throughput fix: the ORDER BY is '
  'first_seen_at DESC, so these rows only ever padded the tail of the batch — '
  'they cost ~10-25 wasted submits/day and streak churn, they were not displacing '
  'fresh candidates (~80% of which are scanned). A cadence, not an exclusion: a '
  '400 is not permanent. Self-correcting, since a successful submit replaces '
  'urlscan_evidence and drops the 400 stamp.';
