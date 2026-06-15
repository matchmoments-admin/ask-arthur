-- migration-v184-netcraft-auto-candidates.sql
--
-- PR3 — Netcraft auto-report for high-confidence branded clones.
--
-- Adds list_clone_alerts_pending_netcraft_auto: the candidate selector for the
-- clone-watch-netcraft-auto producer cron. Mirrors
-- list_clone_alerts_pending_urlscan_submit (v178) but gates for Netcraft
-- submission rather than urlscan enrichment:
--   * a brand was inferred (inferred_target_domain IS NOT NULL),
--   * the Haiku preclassifier judged it a clone with confidence >= threshold
--     (clone_watch_classifications.is_clone AND confidence >= p_min_confidence),
--   * it has NOT already been submitted to Netcraft (submitted_to ? 'netcraft'),
--   * it is not a confirmed false positive (triage_status <> 'fp'),
--   * it is not one of the generic-dictionary-word FP brands (domain.com.au /
--     allhomes.com.au / lendi.com.au) — mirrors FP_BRAND_DENYLIST in
--     clone-watch-submit-netcraft.ts, which remains the authoritative hard
--     guard; excluding here just avoids emitting events the worker would skip.
--
-- The producer turns each returned row into a shopfront/clone.netcraft-auto.v1
-- event; the existing submit-netcraft worker (idempotency on alertId +
-- submitted_to.netcraft dedup + rate-limit) performs the actual submission, so
-- this never double-reports. Netcraft re-verifies every submission before any
-- blocklisting, so good-faith reporting of likely clones is safe.
--
-- Idempotent: CREATE OR REPLACE. SECURITY DEFINER (reads across alerts +
-- classifications); EXECUTE revoked from PUBLIC/anon/authenticated — only the
-- service role (the Inngest producer) calls it.

CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_netcraft_auto(
  p_limit integer DEFAULT 30,
  p_min_confidence real DEFAULT 0.7
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
    AND EXISTS (
      SELECT 1
      FROM public.clone_watch_classifications c
      WHERE c.alert_id = sca.id
        AND c.is_clone
        AND c.confidence >= p_min_confidence
    )
  ORDER BY sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$function$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_netcraft_auto(integer, real)
  FROM PUBLIC, anon, authenticated;
