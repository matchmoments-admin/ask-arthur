-- migration-v251-resubmit-include-already-filed.sql
--
-- Clone-Watch — v250's resubmit worklist excluded weaponised clones that had
-- already been escalated once. That was the wrong call, and it was made for the
-- wrong reason: to keep computeDurationKpis' refileToTakedown median
-- unambiguous. Measurement was allowed to decide who gets reported.
--
-- The 6 alerts it excluded, checked 2026-07-26:
--
--   airwalleex.com              (airwallex)  filed 2026-07-10, no takedown
--   getrevolution.shop          (revolut)    filed 2026-07-11, no takedown
--   revolut8.cc                 (revolut)    filed 2026-07-11, no takedown
--   bombondshq.shop             (bonds)      filed 2026-07-11, no takedown
--   voice-accept-whatsapp.shop  (whatsapp)   filed 2026-07-11, no takedown
--   mybombonds.shop             (bonds)      filed 2026-07-14, no takedown
--
-- All six are urlscan `likely_phishing`. NONE carries a takedown_at — Netcraft
-- never actioned any of them. Five of six still resolve DNS; only revolut8.cc
-- is NXDOMAIN. voice-accept-whatsapp.shop resolves to a Cloudflare address,
-- so a failed probe from our egress is the "inconclusive, not dead" case v248
-- exists to name.
--
-- So: six brand-impersonating phishing domains, reported once, never actioned,
-- their submission now archived beyond the issue reporter's reach — and the
-- only remaining path was closed to them to protect a statistic. Enforcement
-- decides who gets reported. The KPI bends around that, not the reverse.
--
-- The measurement stays honest a better way: duration-kpis.ts now drops BOTH
-- legs that end at takedown_at (refileToTakedown, fullLoop) for any row with
-- netcraft.resubmit_count > 0, because on a resubmitted row that takedown
-- belongs to a different submission than the one the issue was filed against.
--
-- Single-predicate change; everything else is v250 verbatim.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(
  p_limit integer DEFAULT 10,
  p_min_age_days integer DEFAULT 30,
  p_cooldown_days integer DEFAULT 14,
  p_max_resubmits integer DEFAULT 3
)
RETURNS TABLE(
  id bigint,
  candidate_url text,
  candidate_domain text,
  inferred_target_domain text,
  urlscan_uuid text,
  weaponised_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH used AS (
    SELECT count(*) AS n
    FROM public.shopfront_clone_alerts sca
    WHERE (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at')::timestamptz
            > pg_catalog.now() - pg_catalog.make_interval(hours => 24)
  ),
  -- The 24h budget bounds the result via a window rank, not LIMIT: `LIMIT` may
  -- not reference a column from the query (42P10), only constants and params.
  elig AS (
  SELECT
    sca.id,
    sca.candidate_url,
    sca.candidate_domain,
    sca.inferred_target_domain,
    sca.urlscan_uuid,
    sca.weaponised_at,
    -- Freshest attacks first: a clone that weaponised today is still live and
    -- still taking victims; a 60-day-old one probably is not.
    row_number() OVER (
      ORDER BY sca.weaponised_at DESC NULLS LAST, sca.id ASC
    ) AS rn
  FROM public.shopfront_clone_alerts sca
  WHERE sca.lifecycle_state = 'weaponised'
    AND sca.candidate_url IS NOT NULL
    -- No usable submission: never submitted, malformed, or aged out of the
    -- reporter's window. v251 — a prior escalation no longer disqualifies a
    -- row. If it was filed, Netcraft never actioned it, and the submission has
    -- since aged out, then a fresh report is the ONLY path left and the alert
    -- is by definition one we already believed was serving phishing.
    AND (
      NOT (sca.submitted_to ? 'netcraft')
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at') IS NULL
      OR (sca.submitted_to -> 'netcraft' ->> 'submitted_at')::timestamptz
           < pg_catalog.now() - pg_catalog.make_interval(days => p_min_age_days)
    )
    -- Already actioned → nothing to re-report. (An alert Netcraft took down
    -- leaves lifecycle_state='taken_down' and fails the predicate above, but a
    -- takedown_at with the row still weaponised is possible under the v249
    -- no-downgrade rule, so guard it explicitly.)
    AND (sca.submitted_to -> 'netcraft' ->> 'takedown_at') IS NULL
    AND (
      (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at') IS NULL
      OR (sca.submitted_to -> 'netcraft' ->> 'resubmitted_at')::timestamptz
           < pg_catalog.now() - pg_catalog.make_interval(days => p_cooldown_days)
    )
    AND COALESCE((sca.submitted_to -> 'netcraft' ->> 'resubmit_count')::int, 0)
          < GREATEST(1, p_max_resubmits)
  )
  SELECT
    e.id,
    e.candidate_url,
    e.candidate_domain,
    e.inferred_target_domain,
    e.urlscan_uuid,
    e.weaponised_at
  FROM elig e
  WHERE e.rn <= GREATEST(0, LEAST(p_limit, p_limit - (SELECT used.n FROM used)))
  ORDER BY e.rn;
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_pending_netcraft_resubmit(integer, integer, integer, integer) IS
  'v251. Weaponised clones with NO usable Netcraft submission (never submitted, or aged past the issue reporter''s 30-day window) and no recorded takedown — INCLUDING ones escalated once via report_issue, since a fresh report is their only remaining path. Bounded by a per-alert cooldown, a per-alert resubmit ceiling and a 24h global budget applied via a window rank.';
