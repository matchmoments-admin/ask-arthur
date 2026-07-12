-- migration-v222-clone-recheck-risk-inputs.sql
--
-- F3 (docs/plans/clone-watch-brand-value-features.md): the recheck worklist
-- RPC now returns the weaponisation-risk score INPUTS so the recheck loop can
-- over-fetch (~200), rank in TypeScript, and rescan the highest-risk 50 first
-- — faster flip detection for the same urlscan budget.
--
-- THE SCORE FORMULA LIVES IN ONE PLACE: TypeScript
-- (apps/web/lib/clone-watch/weaponisation-risk.ts). This migration returns
-- raw inputs only — no SQL copy of the math (the outcome-copy drift lesson).
--
-- Return-type change ⇒ DROP + CREATE (CREATE OR REPLACE cannot alter OUT
-- columns); atomic inside the migration transaction, so no live gap. The
-- WHERE + ORDER BY are UNCHANGED from v199 (staleness-first) so the partial
-- index idx_clone_alerts_recheck still serves the query; risk ordering is
-- applied TS-side over the fetched window. Extra columns are additive — a
-- pre-deploy TS consumer reading only the old fields keeps working, so
-- applying this migration before the code deploys is safe.

DROP FUNCTION IF EXISTS public.list_clone_alerts_for_recheck(int, int);

CREATE FUNCTION public.list_clone_alerts_for_recheck(
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
SET search_path = public, pg_catalog
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
  -- LATERAL LIMIT 1: known_brands has no uniqueness guarantee on brand_domain
  -- (seeded across v49/v119/v179), and a duplicate row must not fan out the
  -- worklist.
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
      OR sca.last_rechecked_at < now() - make_interval(hours => GREATEST(1, p_cadence_hours))
    )
  ORDER BY sca.last_rechecked_at ASC NULLS FIRST
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_for_recheck(int, int)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_for_recheck(int, int) IS
  'Recheck worklist (monitoring/declined, cadence-gated, staleness-ordered). v222 adds the weaponisation-risk score inputs (signals/attribution/Haiku classification/brand_category) — the score itself is computed ONLY in apps/web/lib/clone-watch/weaponisation-risk.ts.';
