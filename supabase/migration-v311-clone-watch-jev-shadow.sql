-- v311: Jev shadow lane for the clone-watch pre-classifier.
--
-- Why. The Haiku pre-classifier's `confidence` (v157) gates four worklist
-- RPCs at >= 0.7, auto-triage at >= 0.9 and the weaponisation-risk score,
-- and it is measurably uncalibrated: over all 3,496 rows (2026-09-20) Haiku
-- said "clone" at >= 0.8 for 2,255, of which 137 (6%) ever weaponised and
-- 171 were triaged FP; the Netcraft lane's own header records a flat decline
-- curve (1.0-conf declined 84.5%, 0.7-conf 90.5%). TypeSafe Jev is a
-- decision-only model whose output IS a calibrated probability. Before any
-- gate reads it we measure it: run Jev beside Haiku on the identical input,
-- persist here, and compare probability buckets against stored outcomes.
--
-- A SHADOW LANE: nothing in the product path reads this table. It exists to
-- be measured by `clone_watch_jev_calibration()` (below) and deleted if the
-- decision rule fails (docs/ops/clone-watch-config.md § Jev shadow lane).
--
-- Shape mirrors v157: 1:1 sibling of the write-hot shopfront_clone_alerts
-- (ADR-0005), FK + CASCADE so retention purges carry it along, service-role
-- only. No secondary indexes — the read workload is a handful of ad-hoc
-- calibration queries over <= ~5k rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.clone_watch_jev_classifications (
  alert_id            BIGINT PRIMARY KEY
                      REFERENCES public.shopfront_clone_alerts(id) ON DELETE CASCADE,
  brand               TEXT NOT NULL,
  candidate_domain    TEXT NOT NULL,

  -- Noul: P(registered to impersonate the brand for fraud). The calibration
  -- target — Haiku's `is_clone` + `confidence` collapsed into one number.
  is_clone_p          REAL NOT NULL CHECK (is_clone_p >= 0 AND is_clone_p <= 1),

  -- Choice answers keep the same vocabulary as v157 so tactic/intent
  -- agreement between the two classifiers is a plain equality join.
  clone_tactic        TEXT CHECK (clone_tactic IN (
    'typosquat', 'homograph', 'brandjack',
    'lookalike_tld', 'subdomain_abuse',
    'compound_word', 'unrelated', 'parked', 'other'
  )),
  clone_tactic_conf   REAL CHECK (clone_tactic_conf IS NULL OR (clone_tactic_conf >= 0 AND clone_tactic_conf <= 1)),
  clone_tactic_probs  JSONB NOT NULL DEFAULT '{}'::jsonb,

  attack_intent       TEXT CHECK (attack_intent IN (
    'credential_phishing', 'payment_fraud',
    'malware_delivery', 'investment_scam',
    'fake_marketplace', 'crypto_scam',
    'support_scam', 'unknown'
  )),
  attack_intent_conf  REAL CHECK (attack_intent_conf IS NULL OR (attack_intent_conf >= 0 AND attack_intent_conf <= 1)),
  attack_intent_probs JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- { "<indicator>": p } — one Noul per v157 risk_indicators enum value,
  -- a probability per indicator instead of a set.
  risk_indicator_probs JSONB NOT NULL DEFAULT '{}'::jsonb,

  model_id            TEXT NOT NULL,   -- response.model, e.g. jev-1.13.0
  prompt_version      TEXT NOT NULL,   -- rubric version, e.g. jev-v1
  -- 'backfill' rows were classified from the stored v157 input after the
  -- fact; 'live' rows ran beside Haiku in the Inngest fn. Keep them
  -- separable — the backfill is the day-1 curve, live is the confirmation.
  source              TEXT NOT NULL CHECK (source IN ('live', 'backfill')),

  input_tokens        INTEGER,
  latency_ms          INTEGER,

  classified_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clone_watch_jev_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clone_jev_classifications_service_role_all
  ON public.clone_watch_jev_classifications;
CREATE POLICY clone_jev_classifications_service_role_all
  ON public.clone_watch_jev_classifications
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.clone_watch_jev_classifications IS
  'Jev (TypeSafe) shadow-lane output for clone-watch candidates. 1:1 sibling of shopfront_clone_alerts (FK + CASCADE). Read by nothing in the product path; measured by clone_watch_jev_calibration(). v311.';

-- ---------------------------------------------------------------------------
-- RPC: record_clone_watch_jev_classification
-- Idempotent UPSERT keyed on alert_id. Called by the jev-shadow step in
-- clone-watch-haiku-preclassify and by the backfill script.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_clone_watch_jev_classification(
  p_alert_id BIGINT,
  p_brand TEXT,
  p_candidate_domain TEXT,
  p_is_clone_p REAL,
  p_clone_tactic TEXT,
  p_clone_tactic_conf REAL,
  p_clone_tactic_probs JSONB,
  p_attack_intent TEXT,
  p_attack_intent_conf REAL,
  p_attack_intent_probs JSONB,
  p_risk_indicator_probs JSONB,
  p_model_id TEXT,
  p_prompt_version TEXT,
  p_source TEXT,
  p_input_tokens INTEGER,
  p_latency_ms INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
BEGIN
  INSERT INTO public.clone_watch_jev_classifications (
    alert_id, brand, candidate_domain,
    is_clone_p,
    clone_tactic, clone_tactic_conf, clone_tactic_probs,
    attack_intent, attack_intent_conf, attack_intent_probs,
    risk_indicator_probs,
    model_id, prompt_version, source,
    input_tokens, latency_ms, classified_at
  )
  VALUES (
    p_alert_id, p_brand, p_candidate_domain,
    p_is_clone_p,
    p_clone_tactic, p_clone_tactic_conf, COALESCE(p_clone_tactic_probs, '{}'::jsonb),
    p_attack_intent, p_attack_intent_conf, COALESCE(p_attack_intent_probs, '{}'::jsonb),
    COALESCE(p_risk_indicator_probs, '{}'::jsonb),
    p_model_id, p_prompt_version, p_source,
    p_input_tokens, p_latency_ms, now()
  )
  ON CONFLICT (alert_id) DO UPDATE
    SET brand                = EXCLUDED.brand,
        candidate_domain     = EXCLUDED.candidate_domain,
        is_clone_p           = EXCLUDED.is_clone_p,
        clone_tactic         = EXCLUDED.clone_tactic,
        clone_tactic_conf    = EXCLUDED.clone_tactic_conf,
        clone_tactic_probs   = EXCLUDED.clone_tactic_probs,
        attack_intent        = EXCLUDED.attack_intent,
        attack_intent_conf   = EXCLUDED.attack_intent_conf,
        attack_intent_probs  = EXCLUDED.attack_intent_probs,
        risk_indicator_probs = EXCLUDED.risk_indicator_probs,
        model_id             = EXCLUDED.model_id,
        prompt_version       = EXCLUDED.prompt_version,
        source               = EXCLUDED.source,
        input_tokens         = EXCLUDED.input_tokens,
        latency_ms           = EXCLUDED.latency_ms,
        classified_at        = now();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_clone_watch_jev_classification(
  BIGINT, TEXT, TEXT, REAL, TEXT, REAL, JSONB, TEXT, REAL, JSONB, JSONB, TEXT, TEXT, TEXT, INTEGER, INTEGER
)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.record_clone_watch_jev_classification(
  BIGINT, TEXT, TEXT, REAL, TEXT, REAL, JSONB, TEXT, REAL, JSONB, JSONB, TEXT, TEXT, TEXT, INTEGER, INTEGER
) IS
  'Idempotent UPSERT for Jev shadow-lane output. Re-classify safely overwrites the prior row. v311.';

-- ---------------------------------------------------------------------------
-- RPC: clone_watch_jev_calibration
-- The decision instrument. One row per (classifier, probability bucket)
-- with the outcome counts joined from shopfront_clone_alerts, so "is Jev
-- calibrated where Haiku is flat?" is a query, not an argument.
--
--   classifier = 'haiku' — v157 confidence, is_clone = true rows bucketed
--                          1..10; is_clone = false rows land in bucket 0
--                          regardless of confidence (Haiku's confidence is
--                          "how sure of the bool", not P(clone)).
--   classifier = 'jev'   — v311 is_clone_p bucketed 1..10.
--
-- width_bucket(p, 0, 1.0001, 10): bucket k covers [ (k-1)/10, k/10 ); the
-- +0.0001 keeps p = 1.0 inside bucket 10 instead of the overflow bucket 11.
-- Only alerts that BOTH classifiers scored are compared, so the two curves
-- sit over the same population.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clone_watch_jev_calibration()
RETURNS TABLE (
  classifier        TEXT,
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
  WITH shared AS (
    SELECT
      a.id,
      (a.urlscan_classification = 'likely_phishing')       AS is_phish,
      (a.weaponised_at IS NOT NULL)                        AS is_weaponised,
      (a.netcraft_declined_at IS NOT NULL)                 AS is_declined,
      (a.triage_status = 'fp')                             AS is_fp,
      (a.triage_status = 'tp_actioned')                    AS is_actioned,
      CASE WHEN h.is_clone THEN width_bucket(h.confidence, 0, 1.0001, 10) ELSE 0 END AS haiku_bucket,
      width_bucket(j.is_clone_p, 0, 1.0001, 10)            AS jev_bucket
    FROM public.shopfront_clone_alerts a
    JOIN public.clone_watch_classifications     h ON h.alert_id = a.id
    JOIN public.clone_watch_jev_classifications j ON j.alert_id = a.id
  ),
  both_sides AS (
    SELECT 'haiku'::text AS classifier, haiku_bucket AS bucket, is_phish, is_weaponised, is_declined, is_fp, is_actioned FROM shared
    UNION ALL
    SELECT 'jev'::text,   jev_bucket,                 is_phish, is_weaponised, is_declined, is_fp, is_actioned FROM shared
  )
  SELECT
    b.classifier,
    b.bucket::integer,
    count(*)::bigint,
    count(*) FILTER (WHERE b.is_phish)::bigint,
    count(*) FILTER (WHERE b.is_weaponised)::bigint,
    count(*) FILTER (WHERE b.is_declined)::bigint,
    count(*) FILTER (WHERE b.is_fp)::bigint,
    count(*) FILTER (WHERE b.is_actioned)::bigint
  FROM both_sides b
  GROUP BY b.classifier, b.bucket
  ORDER BY b.classifier, b.bucket;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_jev_calibration()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.clone_watch_jev_calibration() IS
  'Haiku-vs-Jev calibration curves over the alerts both classifiers scored: outcome counts per probability bucket. Decision instrument for the Jev shadow lane. v311.';

COMMIT;
