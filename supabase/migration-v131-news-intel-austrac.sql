-- v131 — Add 'austrac' narrative source (PR-B3, first Phase B vertical slice).
--
-- AUSTRAC media releases RSS scraper. Money-mule + payments-fraud
-- typology reports — highest-signal content for romance-scam and
-- investment-scam blog topics, not duplicated by any other AU regulator
-- in the existing feed set.
--
-- Why this is the corrected Phase B template (per PR-A3f #242):
--   1. Extends feed_items_source_check (add 'austrac').
--   2. Extends get_unembedded_narrative_feed_items() RPC allowlist.
--   3. Recreates idx_feed_items_unembedded_narrative partial index so
--      it covers the new slug.
--   4. Updates the feed_sources row (slug already seeded in v127) to
--      flip enabled=true and clarify the URL. Future Phase B PRs add
--      new feed_sources rows in this same migration; AUSTRAC is the
--      one exception because v127 pre-seeded it.
--
-- Pre-deploy SQL smoke (per PR-A3f Phase B template step 0): paste
-- this migration into a BEGIN; ... ROLLBACK; block in the Supabase SQL
-- editor before apply_migration to validate constraint + RPC + partial
-- index syntax in one shot.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE FUNCTION /
-- DROP INDEX IF EXISTS / UPDATE ... WHERE.

-- ── 1. Extend feed_items_source_check ─────────────────────────────────────

ALTER TABLE public.feed_items DROP CONSTRAINT IF EXISTS feed_items_source_check;
ALTER TABLE public.feed_items ADD CONSTRAINT feed_items_source_check
  CHECK (source = ANY (ARRAY[
    -- Existing v97 + v128 + v129 slugs (unchanged):
    'reddit', 'user_report', 'verified_scam',
    'scamwatch', 'scamwatch_alert', 'acsc', 'asic_investor',
    'inbound_scamwatch', 'inbound_acsc', 'inbound_austrac', 'inbound_oaic',
    'inbound_afp', 'inbound_acma', 'inbound_idcare', 'inbound_auscert',
    'inbound_ftc', 'inbound_riskybiz', 'inbound_krebs', 'inbound_generic',
    'inbound_ato', 'inbound_sans', 'inbound_tldr_infosec',
    'inbound_thn', 'inbound_securityweek',
    -- v131 (PR-B3):
    'austrac'
  ]));

-- ── 2. Extend get_unembedded_narrative_feed_items() RPC allowlist ─────────

CREATE OR REPLACE FUNCTION public.get_unembedded_narrative_feed_items(
  p_limit INT DEFAULT 40
) RETURNS TABLE (
  id BIGINT, source TEXT, title TEXT, description TEXT, body_md TEXT,
  tags TEXT[], impersonated_brand TEXT, category TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, source, title, description, body_md, tags, impersonated_brand, category
  FROM public.feed_items
  WHERE embedding IS NULL
    AND source IN (
      'scamwatch_alert', 'acsc', 'asic_investor',
      'inbound_scamwatch', 'inbound_acsc', 'inbound_austrac', 'inbound_oaic',
      'inbound_afp', 'inbound_acma', 'inbound_idcare', 'inbound_auscert',
      'inbound_ftc', 'inbound_riskybiz', 'inbound_krebs', 'inbound_generic',
      'inbound_ato', 'inbound_sans', 'inbound_tldr_infosec',
      'inbound_thn', 'inbound_securityweek',
      -- v131:
      'austrac'
    )
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION public.get_unembedded_narrative_feed_items(INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unembedded_narrative_feed_items(INT) TO service_role;

-- ── 3. Recreate the partial unembedded index to cover the new slug ────────

DROP INDEX IF EXISTS public.idx_feed_items_unembedded_narrative;
CREATE INDEX idx_feed_items_unembedded_narrative
  ON public.feed_items (created_at DESC)
  WHERE embedding IS NULL
    AND source IN (
      'scamwatch_alert', 'acsc', 'asic_investor',
      'inbound_scamwatch', 'inbound_acsc', 'inbound_austrac', 'inbound_oaic',
      'inbound_afp', 'inbound_acma', 'inbound_idcare', 'inbound_auscert',
      'inbound_ftc', 'inbound_riskybiz', 'inbound_krebs', 'inbound_generic',
      'inbound_ato', 'inbound_sans', 'inbound_tldr_infosec',
      'inbound_thn', 'inbound_securityweek',
      'austrac'
    );

-- ── 4. Activate the AUSTRAC feed_sources row (pre-seeded enabled=false in v127) ─

UPDATE public.feed_sources
SET enabled = true,
    url = 'https://www.austrac.gov.au/news-and-media/media-releases/rss',
    notes = 'PR-B3 v131. Money-mule + payments-fraud typology reports. RSS scraper in pipeline/scrapers/austrac.py — mirrors acsc_alerts.py template. First Phase B vertical slice validating the corrected template (skill add-inbound-email-source + plan threat-intel-ingestion.md §7).'
WHERE slug = 'austrac';

-- ── 5. Verification (run after apply) ────────────────────────────────────
--
-- SELECT slug, enabled, url FROM public.feed_sources WHERE slug='austrac';
-- Expect: enabled=true, url ends in /rss.
--
-- SELECT 1 FROM public.feed_items WHERE source='austrac' LIMIT 1;
-- Expect: 0 rows immediately after apply; populates on next scraper cron firing.
