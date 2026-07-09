-- v212 — competitor_intel_observations: per-scam extractions from ingested
--        competitor newsletters (Arthur's Watch Phase 2).
--
-- Why: a competitor newsletter (Which?, AARP, MSE) is one feed_items row but
-- describes several distinct scams. To use them as intelligence we split each
-- newsletter into structured per-scam observations via one Sonnet call
-- (packages/scam-engine competitor-intel extraction), each written in Arthur's
-- OWN words — never verbatim competitor prose (ADR-0021 / plan §3 prompt
-- contract). These observations feed the weekly cohort + the operator
-- coverage-gap digest; they are never shown to the public.
--
-- Service-role only (RLS enabled, no policy → deny anon/authenticated;
-- service_role bypasses RLS). Mirrors the reddit_post_intel access model.
-- No embedding column here — if similarity/dedup vs Arthur's own coverage is
-- needed later it goes on a 1:1 sibling (ADR-0005), never on this parent.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS public.competitor_intel_observations (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Source newsletter row. CASCADE so deleting a quarantined newsletter also
  -- clears its extractions.
  feed_item_id   BIGINT NOT NULL REFERENCES public.feed_items(id) ON DELETE CASCADE,
  source         TEXT NOT NULL,               -- denormalised inbound_<tag> for cohort filtering
  scam_title     TEXT NOT NULL,               -- short headline, Arthur's words
  scam_type      TEXT,                        -- mapped to our scam taxonomy (phishing, phone_scam, …)
  brands         TEXT[] NOT NULL DEFAULT '{}', -- impersonated brands named in the item
  tactic         TEXT,                        -- the mechanism / the tell
  summary        TEXT NOT NULL,               -- 1–2 sentence paraphrase, Arthur's words (never verbatim)
  country_code   TEXT,                        -- ISO-3166-1 alpha-2 where the item is region-specific
  novelty        TEXT,                        -- 'new' | 'rising' | 'ongoing' | NULL (model hint)
  confidence     REAL,                        -- extraction confidence 0..1
  model_version  TEXT,
  prompt_version TEXT,
  extracted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-running extraction on the same newsletter must not duplicate rows.
  CONSTRAINT competitor_intel_observations_unique UNIQUE (feed_item_id, scam_title)
);

CREATE INDEX IF NOT EXISTS idx_competitor_intel_obs_feed_item
  ON public.competitor_intel_observations (feed_item_id);
CREATE INDEX IF NOT EXISTS idx_competitor_intel_obs_source_time
  ON public.competitor_intel_observations (source, extracted_at DESC);

ALTER TABLE public.competitor_intel_observations ENABLE ROW LEVEL SECURITY;
-- Deny-all to anon/authenticated; service_role bypasses RLS. (Explicit no-op
-- policy drop keeps the migration re-runnable.)
DROP POLICY IF EXISTS competitor_intel_observations_no_access ON public.competitor_intel_observations;

COMMENT ON TABLE public.competitor_intel_observations IS
  'Per-scam extractions from ingested competitor newsletters (Arthur''s Watch Phase 2). Arthur-worded, never verbatim. Service-role only. See docs/adr/0021 + docs/plans/arthurs-watch-newsletter.md.';
