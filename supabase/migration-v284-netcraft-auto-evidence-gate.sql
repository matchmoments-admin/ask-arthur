-- Migration v284 — Netcraft auto-lane: gate submission on EVIDENCE, not lexical confidence
--
-- WHY (measured against prod 2026-08-23, not inferred from code):
--
--   2,151 alerts have been submitted to Netcraft. 1,923 of them (89.4%) were
--   declined. Netcraft's own monthly scorecard credits ~10 reports lifetime.
--
--   The cause is this function's gate. It admitted any alert the Haiku
--   preclassifier called a clone at confidence >= 0.7 — a LEXICAL judgement
--   about how the domain is spelled — and nothing else. That score turns out
--   to have no predictive power over Netcraft's verdict at all:
--
--     confidence 1.0 -> 84.5% declined      confidence 0.8 -> 91.1% declined
--     confidence 0.9 -> 90.4% declined      confidence 0.7 -> 90.5% declined
--
--   A flat curve. Our most-confident candidates were rejected 5 times in 6.
--
--   The signal we already collect and did NOT use is ~10x stronger:
--
--     urlscan likely_phishing -> 53.3% survive     never scanned  -> 18.2%
--     urlscan neutral         ->  5.1% survive     parked_for_sale ->  0.0%
--
--   So this adds the SAME evidence predicate the issue reporter has enforced
--   since v221 (`likely_phishing OR weaponised`). The submit stage having no
--   evidence gate while the escalate stage had a strict one was the asymmetry.
--
-- The companion change is a cron move (see clone-watch-netcraft-auto.ts): the
-- lane fired 09:30, while urlscan-submit runs 09:00 and urlscan-retrieve runs
-- `0 */3` — so the first verdict cannot exist before 12:00. The lane was
-- reporting 2.5h before the evidence it needed could possibly exist, which is
-- why 407 alerts reached Netcraft with no scan at all. Moved to 13:00.
--
-- Note this predicate also OPENS a path that did not exist: an alert that
-- weaponises without ever having been submitted. The v250 resubmit lane only
-- covers alerts already carrying a uuid (min age 30 days), so a
-- weaponised-but-never-submitted clone previously had no route to Netcraft.
--
-- Signature is unchanged on purpose — adding a `p_require_evidence` default
-- argument would create an overload and make the existing 2-arg call site
-- ambiguous. The gate is deliberately hard-coded: this defect was an
-- unenforced policy, and a knob is how it comes back.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_auto(
  p_min_confidence real DEFAULT 0.7,
  p_daily_cap integer DEFAULT 50
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  severity_tier text,
  signals jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH today AS (
    SELECT count(*)::int AS n
    FROM public.shopfront_clone_alerts
    WHERE submitted_to -> 'netcraft' ->> 'via' = 'auto_bulk'
      AND (submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
            >= date_trunc('day', now())
  )
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.severity_tier,
    sca.signals
  FROM public.shopfront_clone_alerts sca
  WHERE sca.inferred_target_domain IS NOT NULL
    AND NOT (sca.submitted_to ? 'netcraft')
    AND COALESCE(sca.triage_status, '') <> 'fp'
    AND lower(sca.inferred_target_domain) NOT IN
      ('domain.com.au', 'allhomes.com.au', 'lendi.com.au')
    AND sca.first_seen_at >= now() - interval '180 days'
    -- v284 evidence gate: an independent observation that this host is
    -- actually hostile. Mirrors the issue reporter's v221 predicate.
    AND (
      sca.urlscan_classification = 'likely_phishing'
      OR sca.lifecycle_state = 'weaponised'
    )
    AND EXISTS (
      SELECT 1
      FROM public.clone_watch_classifications c
      WHERE c.alert_id = sca.id
        AND c.is_clone
        AND c.confidence >= p_min_confidence
    )
  ORDER BY
    -- Weaponised first: those are live and already escalation-eligible.
    (sca.lifecycle_state = 'weaponised') DESC,
    -- Then freshest, because time-to-report drives time-to-takedown. Lexical
    -- confidence survives only as a tiebreak — v284 measured it as noise for
    -- ranking purposes, so it must not lead.
    sca.first_seen_at DESC,
    (SELECT max(c.confidence)
       FROM public.clone_watch_classifications c
       WHERE c.alert_id = sca.id AND c.is_clone) DESC NULLS LAST
  LIMIT LEAST(
    GREATEST(0, p_daily_cap - (SELECT n FROM today)),
    50
  );
$function$;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_auto(real, integer) IS
  'Netcraft auto-lane worklist. v284: requires urlscan likely_phishing OR lifecycle weaponised — lexical classifier confidence alone was measured at 89.4% decline with a flat confidence curve. Call AFTER urlscan-retrieve (cron 13:00), never before.';
