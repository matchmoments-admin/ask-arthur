-- v197 — clone-alert triage corroboration
--        (Phase 2 of docs/plans/brand-convergence-seam.md)
--
-- WHY: a lexical NRD clone hit is low-confidence alone. If the SAME brand is
-- ALSO actively surfacing in the watchlist-candidate queue (Reddit mentions +
-- reported scams, Phase 1), that's independent corroboration the brand is under
-- live attack — which should float that clone alert up the operator triage
-- queue. This is a BRAND-level join via the canonical key; it NEVER mutates the
-- deterministic clone `severity` (ADR-0015) and it does NOT merge alert tables
-- (ADR-0016) — `inferred_target_domain` stays the clone discriminator and gains
-- a SIBLING `target_brand_normalized`.
--
-- SCOPE:
--   1. shopfront_clone_alerts.target_brand_normalized TEXT + partial btree.
--   2. Best-effort backfill from the SQL-available domain→brand maps.
--   3. upsert_clone_alerts_batch writes it at NRD-match time (COALESCE on
--      conflict so a re-observation never nulls it).
--   4. list_clone_alerts_pending_triage LEFT JOINs the candidate queue on the
--      canonical key, returns corroboration as SEPARATE named columns, and adds
--      an ADDITIVE ORDER-BY term gated by a p_corroboration_priority param
--      (SQL can't read env; the flag lives in code and is passed in).
--
-- shopfront_clone_alerts is NOT a hot table (~1.3K rows). Additive + idempotent.

-- 1. Sibling brand key on the clone alert (nullable; no default → catalog-only,
--    no table rewrite). inferred_target_domain is untouched.
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS target_brand_normalized TEXT;

CREATE INDEX IF NOT EXISTS idx_clone_alerts_target_brand
  ON public.shopfront_clone_alerts (target_brand_normalized)
  WHERE target_brand_normalized IS NOT NULL;

-- 2. Best-effort backfill: map inferred_target_domain → brand via the two
--    SQL-available legit-domain registries, then normalise. Watchlist-only
--    domains not in either registry stay NULL and simply get populated by the
--    next NRD ingest that re-observes them (write path in step 3). Single
--    UPDATE — the table is small and not on the hot list.
UPDATE public.shopfront_clone_alerts a
SET target_brand_normalized = public.brand_normalize(m.brand)
FROM (
  SELECT legitimate_domain AS domain, brand
    FROM public.brand_contact_directory WHERE legitimate_domain IS NOT NULL
  UNION
  SELECT brand_domain AS domain, brand_name AS brand
    FROM public.known_brands WHERE brand_domain IS NOT NULL
) m
WHERE a.target_brand_normalized IS NULL
  AND a.inferred_target_domain IS NOT NULL
  AND lower(a.inferred_target_domain) = lower(m.domain)
  AND public.brand_normalize(m.brand) IS NOT NULL;

-- 3. Write target_brand_normalized at match time. Signature unchanged (p_rows
--    JSONB) so CREATE OR REPLACE is safe. COALESCE on conflict: a re-observation
--    that omits the brand never nulls a populated value.
CREATE OR REPLACE FUNCTION public.upsert_clone_alerts_batch(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  SET LOCAL statement_timeout = '300s';

  WITH upsert AS (
    INSERT INTO public.shopfront_clone_alerts (
      target_shop_id,
      inferred_target_domain,
      candidate_domain,
      candidate_url,
      url_hash,
      signals,
      severity,
      severity_tier,
      source,
      target_brand_normalized
    )
    SELECT
      NULLIF(r->>'target_shop_id', '')::BIGINT,
      r->>'inferred_target_domain',
      r->>'candidate_domain',
      r->>'candidate_url',
      r->>'url_hash',
      COALESCE(r->'signals', '[]'::jsonb),
      (r->>'severity')::SMALLINT,
      CASE
        WHEN r->>'severity_tier' IN ('low', 'medium', 'high', 'critical')
          THEN r->>'severity_tier'
        ELSE 'low'
      END,
      r->>'source',
      NULLIF(r->>'target_brand_normalized', '')
    FROM jsonb_array_elements(p_rows) AS r
    ON CONFLICT (
      COALESCE(target_shop_id::text, inferred_target_domain),
      url_hash
    )
    DO UPDATE SET
      last_seen_at = NOW(),
      updated_at = NOW(),
      signals = EXCLUDED.signals,
      severity = GREATEST(public.shopfront_clone_alerts.severity, EXCLUDED.severity),
      severity_tier = CASE
        WHEN EXCLUDED.severity > public.shopfront_clone_alerts.severity
        THEN EXCLUDED.severity_tier
        ELSE public.shopfront_clone_alerts.severity_tier
      END,
      target_brand_normalized = COALESCE(
        EXCLUDED.target_brand_normalized,
        public.shopfront_clone_alerts.target_brand_normalized
      )
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT COUNT(*) FILTER (WHERE was_inserted) INTO inserted_count FROM upsert;

  RETURN inserted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_clone_alerts_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_clone_alerts_batch(JSONB) TO service_role;

-- 4. Triage queue + corroboration. Return-type change (new columns) → DROP +
--    CREATE, per the v158 precedent. The corroboration columns are ALWAYS
--    exposed; only the ORDER-BY priority is gated (by the caller's flag, passed
--    as p_corroboration_priority). severity is never referenced in ORDER BY.
DROP FUNCTION IF EXISTS public.list_clone_alerts_pending_triage(int);
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_triage(
  p_limit int DEFAULT 100,
  p_corroboration_priority boolean DEFAULT false
)
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
  likely_tp boolean,
  cross_stream_corroborated boolean,
  corroboration_mention_count int,
  corroboration_source_counts jsonb
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
    COALESCE(cwc.is_clone AND cwc.confidence >= 0.6, false) AS likely_tp,
    -- Cross-stream corroboration (Phase 2). A pending candidate row for the
    -- SAME canonical brand means Reddit and/or reported-scams are naming it now.
    (wc.brand_normalized IS NOT NULL)          AS cross_stream_corroborated,
    COALESCE(wc.mention_count, 0)              AS corroboration_mention_count,
    COALESCE(wc.source_counts, '{}'::jsonb)    AS corroboration_source_counts
  FROM public.shopfront_clone_alerts sca
  LEFT JOIN public.clone_watch_classifications cwc ON cwc.alert_id = sca.id
  LEFT JOIN public.reddit_watchlist_candidates wc
    ON wc.brand_normalized = sca.target_brand_normalized
   AND wc.status = 'pending'
  WHERE sca.triage_status = 'pending'
    AND sca.source = 'nrd'
  ORDER BY
    -- 0. ADDITIVE corroboration term — ONLY active when the caller passes the
    --    flag. A no-op (0 for every row) otherwise. Never touches severity.
    (CASE WHEN p_corroboration_priority
          THEN COALESCE(wc.mention_count, 0) ELSE 0 END) DESC,
    -- 1. Likely-TPs first
    (COALESCE(cwc.is_clone AND cwc.confidence >= 0.6, false)) DESC,
    -- 2. Then classifier confidence DESC (un-classified fall to bottom)
    cwc.confidence DESC NULLS LAST,
    -- 3. Final tiebreak: newest first
    sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_triage(int, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clone_alerts_pending_triage(int, boolean)
  TO service_role;

COMMENT ON FUNCTION public.list_clone_alerts_pending_triage(int, boolean) IS
  'Pending-triage queue for /admin/clone-watch. v197 adds cross-stream corroboration (target_brand_normalized JOIN to reddit_watchlist_candidates): three always-exposed columns + an additive ORDER-BY term gated by p_corroboration_priority (FF_CLONE_TRIAGE_CORROBORATION). Never touches severity (ADR-0015).';