-- v100 — shop_review_findings: durable per-domain registry of shops whose
-- on-page reviews Deep Shop Check flagged as suspicious/manipulated.
--
-- Motivation: shop_checks rows are per-click and TTL-swept (90 days), so they
-- can't back a lasting "which sites have fake reviews" reputation warning for
-- the community. This table is deduped by domain, has NO TTL, and preserves
-- the worst verdict ever seen for a domain (a later clean check never erases a
-- prior manipulated finding). Only concerning verdicts are written — a clean
-- store never creates a warning entry.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.shop_review_findings (
  domain            text PRIMARY KEY,
  review_app        text NOT NULL,
  latest_verdict    text NOT NULL,
  worst_verdict     text NOT NULL,
  total_reviews     integer,
  average_rating    numeric(3, 2),
  distribution      jsonb,
  fake_likelihood   numeric(4, 3),
  composite_score   smallint,
  reasons           jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_url        text,
  check_count       integer NOT NULL DEFAULT 1,
  first_flagged_at  timestamptz NOT NULL DEFAULT now(),
  last_checked_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.shop_review_findings IS
  'Durable per-domain registry of shops whose on-page reviews were flagged suspicious/manipulated by Deep Shop Check. Backs community reputation warnings. No TTL (unlike shop_checks). Worst verdict is retained across re-checks.';

-- Query helper: "most-flagged / recently-flagged" reporting.
CREATE INDEX IF NOT EXISTS shop_review_findings_worst_verdict_idx
  ON public.shop_review_findings (worst_verdict, last_checked_at DESC);

-- Locked down: the enrich worker writes via the service role (which bypasses
-- RLS); no anon/authenticated access. A future public warnings surface should
-- read through a dedicated view/policy, added when that surface is designed.
ALTER TABLE public.shop_review_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.shop_review_findings;
CREATE POLICY "service_role_all" ON public.shop_review_findings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Verdict severity ranking, used to keep worst_verdict monotonic.
CREATE OR REPLACE FUNCTION public.review_verdict_severity(v text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE v
    WHEN 'manipulated' THEN 2
    WHEN 'suspicious' THEN 1
    ELSE 0
  END
$$;

-- Atomic upsert. RETURNS void (no OUT-param shadowing, so no
-- #variable_conflict needed). search_path pinned to public + pg_catalog so the
-- severity helper resolves; SECURITY INVOKER because the only caller is the
-- service role and there is no unqualified-name exploitation surface.
CREATE OR REPLACE FUNCTION public.upsert_shop_review_finding(
  p_domain          text,
  p_review_app      text,
  p_verdict         text,
  p_total_reviews   integer,
  p_average_rating  numeric,
  p_distribution    jsonb,
  p_fake_likelihood numeric,
  p_composite_score smallint,
  p_reasons         jsonb,
  p_sample_url      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.shop_review_findings AS f (
    domain, review_app, latest_verdict, worst_verdict, total_reviews,
    average_rating, distribution, fake_likelihood, composite_score,
    reasons, sample_url
  ) VALUES (
    p_domain, p_review_app, p_verdict, p_verdict, p_total_reviews,
    p_average_rating, p_distribution, p_fake_likelihood, p_composite_score,
    COALESCE(p_reasons, '[]'::jsonb), p_sample_url
  )
  ON CONFLICT (domain) DO UPDATE SET
    review_app      = EXCLUDED.review_app,
    latest_verdict  = EXCLUDED.latest_verdict,
    worst_verdict   = CASE
      WHEN public.review_verdict_severity(EXCLUDED.latest_verdict)
         > public.review_verdict_severity(f.worst_verdict)
      THEN EXCLUDED.latest_verdict
      ELSE f.worst_verdict
    END,
    total_reviews   = EXCLUDED.total_reviews,
    average_rating  = EXCLUDED.average_rating,
    distribution    = EXCLUDED.distribution,
    fake_likelihood = EXCLUDED.fake_likelihood,
    composite_score = EXCLUDED.composite_score,
    reasons         = EXCLUDED.reasons,
    sample_url      = EXCLUDED.sample_url,
    check_count     = f.check_count + 1,
    last_checked_at = now();
END;
$$;
