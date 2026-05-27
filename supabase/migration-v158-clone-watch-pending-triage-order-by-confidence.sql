-- v158: list_clone_alerts_pending_triage returns Haiku classifier signal
-- and orders the queue by confidence DESC (PR-D2, #498).
--
-- Why: PR-D2 adds clone_watch_classifications (v157). The operator
-- dashboard pre-rank-by-confidence story needs (a) the columns surfaced
-- on the row payload, (b) the ORDER BY clause updated.
--
-- Behaviour when no classification row exists (flag OFF, or fan-out
-- raced): NULLS LAST keeps un-classified rows at the bottom — the
-- existing first_seen_at ordering kicks in as the tie-break.
--
-- We add a `likely_tp` boolean derived column so the dashboard can render
-- a chip without re-deriving the (is_clone AND confidence > 0.6)
-- predicate on every render.
--
-- DROP + CREATE: return-type change forbids CREATE OR REPLACE on PL/pgSQL
-- RETURNS TABLE shapes that gain columns.

BEGIN;

DROP FUNCTION IF EXISTS public.list_clone_alerts_pending_triage(int);
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_triage(p_limit int DEFAULT 100)
RETURNS TABLE (
  id bigint,
  inferred_target_domain text,
  candidate_domain text,
  candidate_url text,
  signals jsonb,
  severity_tier text,
  triage_status text,
  first_seen_at timestamptz,
  urlscan_classification text,
  urlscan_scanned_at timestamptz,
  urlscan_screenshot_url text,
  urlscan_effective_url text,
  auto_classification_is_clone boolean,
  auto_classification_confidence real,
  auto_classification_clone_tactic text,
  auto_classification_attack_intent text,
  auto_classification_reason text,
  likely_tp boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    sca.id,
    sca.inferred_target_domain,
    sca.candidate_domain,
    sca.candidate_url,
    sca.signals,
    sca.severity_tier,
    sca.triage_status,
    sca.first_seen_at,
    sca.urlscan_classification,
    sca.urlscan_scanned_at,
    (sca.urlscan_evidence->>'screenshot_url')::text AS urlscan_screenshot_url,
    (sca.urlscan_evidence->>'effective_url')::text AS urlscan_effective_url,
    cwc.is_clone        AS auto_classification_is_clone,
    cwc.confidence      AS auto_classification_confidence,
    cwc.clone_tactic    AS auto_classification_clone_tactic,
    cwc.attack_intent   AS auto_classification_attack_intent,
    cwc.reason          AS auto_classification_reason,
    -- Operator-friendly chip predicate: only TRUE when classifier is
    -- confident this is a real clone. Threshold 0.6 — comfortable margin
    -- above the un-classified path (NULL → FALSE). The auto-FP threshold
    -- in PR-D5 will be tighter (≥0.9 or ≥0.95).
    COALESCE(cwc.is_clone AND cwc.confidence >= 0.6, false) AS likely_tp
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  WHERE sca.triage_status = 'pending'
    AND sca.source = 'nrd'
  ORDER BY
    -- 1. Likely-TPs first (true sorts after false; flip with NOT)
    (COALESCE(cwc.is_clone AND cwc.confidence >= 0.6, false)) DESC,
    -- 2. Then confidence DESC (un-classified rows fall to bottom)
    cwc.confidence DESC NULLS LAST,
    -- 3. Final tiebreak: newest first (existing behaviour)
    sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_triage(int)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.list_clone_alerts_pending_triage(int) IS
  'Pending-triage queue for /admin/clone-watch. Extended in v158 with auto_classification_* fields from clone_watch_classifications (PR-D2, #498). Ordered by likely_tp DESC, confidence DESC NULLS LAST, first_seen_at DESC.';

COMMIT;
