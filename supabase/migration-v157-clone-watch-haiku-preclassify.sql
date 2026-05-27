-- v157: Haiku pre-classifier sibling table for clone-watch (PR-D2, #498).
--
-- Stores the output of a Haiku 4.5 classifier that runs after Layer 0
-- NRD ingest. The signal is consumed by:
--   * operator dashboard — pre-rank pending queue by confidence DESC
--   * future B2B intel endpoint (PR-D3, #499) — aggregate trends by
--     brand × tactic × time
--   * future auto-FP path (PR-D5, #501) — gated on back-test data
--   * future cross-feature hydration (PR-D4, #500) — analyze pipeline
--     warning when a scanned URL matches a recent clone-watch hit
--
-- Architectural choice: SIBLING TABLE not JSONB on the parent.
-- shopfront_clone_alerts is write-hot (NRD ingest + urlscan UPDATEs).
-- The classifier output is read-frequent (queue ordering, trends, B2B).
-- Per ADR-0005 + memory `feedback_db_safety_patterns`, indexed read
-- workloads belong on a 1:1 sibling so the parent's IO budget isn't
-- spent maintaining indexes on every UPDATE.
--
-- Lifecycle: ON DELETE CASCADE from shopfront_clone_alerts. When the
-- alert is purged (purge_old_fp_clone_alerts retention), the
-- classification goes with it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.clone_watch_classifications (
  alert_id        BIGINT PRIMARY KEY
                  REFERENCES public.shopfront_clone_alerts(id) ON DELETE CASCADE,
  brand           TEXT NOT NULL,
  candidate_domain TEXT NOT NULL,

  is_clone        BOOLEAN NOT NULL,
  confidence      REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  clone_tactic    TEXT CHECK (clone_tactic IN (
    'typosquat', 'homograph', 'brandjack',
    'lookalike_tld', 'subdomain_abuse',
    'compound_word', 'unrelated', 'parked', 'other'
  )),
  attack_intent   TEXT CHECK (attack_intent IN (
    'credential_phishing', 'payment_fraud',
    'malware_delivery', 'investment_scam',
    'fake_marketplace', 'crypto_scam',
    'support_scam', 'unknown'
  )),
  risk_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,

  reason          TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,

  input_tokens    INTEGER,
  output_tokens   INTEGER,

  classified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the read paths.
--
-- 1. brand + classified_at — B2B + admin trend queries ("how many NAB
--    clones in the last 14 days").
CREATE INDEX IF NOT EXISTS idx_clone_classifications_brand_ts
  ON public.clone_watch_classifications (brand, classified_at DESC);

-- 2. clone_tactic — tactic distribution + B2B "show me typosquats only".
--    Partial: only is_clone rows are operationally interesting.
CREATE INDEX IF NOT EXISTS idx_clone_classifications_tactic
  ON public.clone_watch_classifications (clone_tactic)
  WHERE is_clone = true;

-- 3. confidence DESC — pending-queue ordering (`list_clone_alerts_pending_triage`).
--    Partial: only is_clone TRUE rows benefit from ranking.
CREATE INDEX IF NOT EXISTS idx_clone_classifications_confidence
  ON public.clone_watch_classifications (confidence DESC)
  WHERE is_clone = true;

ALTER TABLE public.clone_watch_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clone_classifications_service_role_all
  ON public.clone_watch_classifications;
CREATE POLICY clone_classifications_service_role_all
  ON public.clone_watch_classifications
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.clone_watch_classifications IS
  'Haiku classifier output for clone-watch candidates. 1:1 sibling of shopfront_clone_alerts (FK + CASCADE). PR-D2 (#498).';

-- ---------------------------------------------------------------------------
-- RPC: record_clone_watch_classification
-- Idempotent UPSERT keyed on alert_id. Called by the new Inngest fn
-- clone-watch-haiku-preclassify.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_clone_watch_classification(
  p_alert_id BIGINT,
  p_brand TEXT,
  p_candidate_domain TEXT,
  p_is_clone BOOLEAN,
  p_confidence REAL,
  p_clone_tactic TEXT,
  p_attack_intent TEXT,
  p_risk_indicators JSONB,
  p_reason TEXT,
  p_model_id TEXT,
  p_prompt_version TEXT,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.clone_watch_classifications (
    alert_id, brand, candidate_domain,
    is_clone, confidence, clone_tactic, attack_intent, risk_indicators,
    reason, model_id, prompt_version,
    input_tokens, output_tokens, classified_at
  )
  VALUES (
    p_alert_id, p_brand, p_candidate_domain,
    p_is_clone, p_confidence, p_clone_tactic, p_attack_intent,
    COALESCE(p_risk_indicators, '[]'::jsonb),
    p_reason, p_model_id, p_prompt_version,
    p_input_tokens, p_output_tokens, now()
  )
  ON CONFLICT (alert_id) DO UPDATE
    SET brand           = EXCLUDED.brand,
        candidate_domain = EXCLUDED.candidate_domain,
        is_clone        = EXCLUDED.is_clone,
        confidence      = EXCLUDED.confidence,
        clone_tactic    = EXCLUDED.clone_tactic,
        attack_intent   = EXCLUDED.attack_intent,
        risk_indicators = EXCLUDED.risk_indicators,
        reason          = EXCLUDED.reason,
        model_id        = EXCLUDED.model_id,
        prompt_version  = EXCLUDED.prompt_version,
        input_tokens    = EXCLUDED.input_tokens,
        output_tokens   = EXCLUDED.output_tokens,
        classified_at   = now();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_clone_watch_classification(
  BIGINT, TEXT, TEXT, BOOLEAN, REAL, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, INTEGER
)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.record_clone_watch_classification(
  BIGINT, TEXT, TEXT, BOOLEAN, REAL, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, INTEGER
) IS
  'Idempotent UPSERT for Haiku classifier output. Re-classify safely overwrites prior row. PR-D2 (#498).';

-- ---------------------------------------------------------------------------
-- RPC: clone_watch_classification_trends
-- Weekly bucket aggregation across brand × tactic for the trend tab +
-- B2B endpoint. Service-role only at this stage; B2B exposure routes
-- through PR-D3 (#499) which adds tier-gated wrappers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clone_watch_classification_trends(
  p_days INTEGER DEFAULT 14,
  p_brand TEXT DEFAULT NULL
)
RETURNS TABLE (
  week_start DATE,
  brand TEXT,
  classified_count INTEGER,
  clone_count INTEGER,
  top_tactic TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      date_trunc('week', c.classified_at)::date AS week_start,
      c.brand                                   AS brand,
      c.is_clone                                AS is_clone,
      c.clone_tactic                            AS clone_tactic
    FROM public.clone_watch_classifications c
    WHERE c.classified_at > now() - (p_days || ' days')::interval
      AND (p_brand IS NULL OR c.brand = p_brand)
  ),
  tactic_counts AS (
    SELECT
      week_start,
      brand,
      clone_tactic,
      COUNT(*) AS n
    FROM base
    WHERE is_clone = true AND clone_tactic IS NOT NULL
    GROUP BY week_start, brand, clone_tactic
  ),
  top_tactic_per_week AS (
    SELECT DISTINCT ON (week_start, brand)
      week_start,
      brand,
      clone_tactic AS top_tactic
    FROM tactic_counts
    ORDER BY week_start, brand, n DESC, clone_tactic
  )
  SELECT
    b.week_start,
    b.brand,
    COUNT(*)::INTEGER                         AS classified_count,
    COUNT(*) FILTER (WHERE b.is_clone)::INTEGER AS clone_count,
    t.top_tactic
  FROM base b
  LEFT JOIN top_tactic_per_week t USING (week_start, brand)
  GROUP BY b.week_start, b.brand, t.top_tactic
  ORDER BY b.week_start DESC, classified_count DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_classification_trends(INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.clone_watch_classification_trends(INTEGER, TEXT) IS
  'Weekly bucket aggregation across brand × tactic for clone-watch classifier output. Service-role only — B2B wrapper added in PR-D3 (#499). PR-D2 (#498).';

COMMIT;
