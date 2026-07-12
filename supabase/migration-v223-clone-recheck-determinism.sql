-- migration-v223-clone-recheck-determinism.sql
--
-- Two review fixes on the v222 recheck worklist (same return shape → plain
-- CREATE OR REPLACE, no drop):
--
--  1. SECURITY DEFINER search_path convention: v222 regressed to
--     `public, pg_catalog`; the codified rule (supabase/CLAUDE.md §4, applied
--     in v216/v221) is `SET search_path = ''` with fully-qualified references.
--     The body was already fully qualified except make_interval/now — both
--     now pg_catalog-qualified.
--  2. Deterministic ordering: `last_rechecked_at ASC NULLS FIRST` alone gives
--     an arbitrary 200-row window among the never-rechecked backlog (equal
--     NULL keys). `sca.id ASC` tiebreak makes the window stable across runs
--     so the TS-side risk ranking rotates the pool predictably.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_for_recheck(
  p_limit int DEFAULT 50,
  p_cadence_hours int DEFAULT 6
)
RETURNS TABLE (
  id bigint,
  candidate_domain text,
  candidate_url text,
  lifecycle_state text,
  urlscan_classification text,
  recheck_count int,
  last_rechecked_at timestamptz,
  signals jsonb,
  attribution jsonb,
  clf_is_clone boolean,
  clf_confidence real,
  clf_attack_intent text,
  clf_clone_tactic text,
  brand_category text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    sca.id,
    sca.candidate_domain,
    sca.candidate_url,
    sca.lifecycle_state,
    sca.urlscan_classification,
    sca.recheck_count,
    sca.last_rechecked_at,
    sca.signals,
    sca.attribution,
    cwc.is_clone,
    cwc.confidence,
    cwc.attack_intent,
    cwc.clone_tactic,
    kb.brand_category
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN LATERAL (
    SELECT kb2.brand_category
    FROM public.known_brands kb2
    WHERE kb2.brand_domain = sca.inferred_target_domain
    LIMIT 1
  ) kb ON true
  WHERE sca.source = 'nrd'
    AND sca.lifecycle_state IN ('monitoring', 'declined')
    AND (
      sca.last_rechecked_at IS NULL
      OR sca.last_rechecked_at
         < pg_catalog.now() - pg_catalog.make_interval(hours => GREATEST(1, p_cadence_hours))
    )
  ORDER BY sca.last_rechecked_at ASC NULLS FIRST, sca.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(int, int)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_for_recheck(int, int) IS
  'Recheck worklist (monitoring/declined, cadence-gated, staleness-ordered with id tiebreak). Returns weaponisation-risk score INPUTS only — the formula lives in apps/web/lib/clone-watch/weaponisation-risk.ts.';
