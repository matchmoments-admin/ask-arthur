-- v129 — Extend inbound-email source allowlist with 5 high-signal additions.
--
-- Why: post-PR-A3 review with the upstream-subscribe pages found that 4 of
-- the original 11 sources don't have email subscriptions at all (AFP, ACMA,
-- AUSTRAC, AusCERT) — those route through Phase B scrapers instead. To keep
-- the email-path source count meaningful, add 5 net-new high-signal
-- newsletters that DO support email subscription:
--   * inbound_ato            — Australian Taxation Office scam alerts
--                              (largest single AU scam category — tax impersonation)
--   * inbound_sans           — SANS NewsBites (weekly, expert-curated)
--   * inbound_tldr_infosec   — TLDR Information Security (daily, ~100k subs)
--   * inbound_thn            — The Hacker News (daily, broad cyber)
--   * inbound_securityweek   — SecurityWeek Daily Briefing
--
-- Idempotent: DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE FUNCTION.

-- ── 1. Extend feed_items_source_check ─────────────────────────────────────

ALTER TABLE public.feed_items DROP CONSTRAINT IF EXISTS feed_items_source_check;
ALTER TABLE public.feed_items ADD CONSTRAINT feed_items_source_check
  CHECK (source = ANY (ARRAY[
    -- Existing v97 + v128 slugs (unchanged):
    'reddit', 'user_report', 'verified_scam',
    'scamwatch', 'scamwatch_alert', 'acsc', 'asic_investor',
    'inbound_scamwatch', 'inbound_acsc', 'inbound_austrac', 'inbound_oaic',
    'inbound_afp', 'inbound_acma', 'inbound_idcare', 'inbound_auscert',
    'inbound_ftc', 'inbound_riskybiz', 'inbound_krebs', 'inbound_generic',
    -- New v129 slugs (5 high-signal additions):
    'inbound_ato',          -- Australian Taxation Office scam alerts
    'inbound_sans',         -- SANS NewsBites (weekly, expert-curated)
    'inbound_tldr_infosec', -- TLDR Information Security (daily terse)
    'inbound_thn',          -- The Hacker News (daily broad cyber)
    'inbound_securityweek'  -- SecurityWeek Daily Briefing
  ]));

-- ── 2. Extend get_unembedded_narrative_feed_items() allowlist ─────────────

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
      -- v129 additions:
      'inbound_ato', 'inbound_sans', 'inbound_tldr_infosec',
      'inbound_thn', 'inbound_securityweek'
    )
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION public.get_unembedded_narrative_feed_items(INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unembedded_narrative_feed_items(INT) TO service_role;

-- ── 3. Extend the partial unembedded index to cover the new slugs ─────────

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
      'inbound_thn', 'inbound_securityweek'
    );

-- ── 4. Seed 5 new feed_sources rows (enabled=false until rules + subs live) ─

INSERT INTO public.feed_sources (slug, name, url, source_type, category, jurisdiction, enabled, poll_schedule, notes) VALUES
  ('inbound_ato', 'ATO scam alerts (email subscription)',
   'https://www.ato.gov.au/online-services/scams-cyber-safety-and-identity-protection/scam-alerts',
   'email', 'narrative', 'AU', false, 'event-driven',
   'PR-A3 extension v129. Tax-impersonation is the largest single AU scam category. Use ato+ingest@askarthur-inbound.com.'),
  ('inbound_sans', 'SANS NewsBites (weekly, expert-curated)',
   'https://www.sans.org/newsletters/',
   'email', 'narrative', 'INT', false, 'event-driven',
   'PR-A3 extension v129. Mentioned in every best-cyber-newsletter list; tier_2_industry.'),
  ('inbound_tldr_infosec', 'TLDR Information Security (daily terse)',
   'https://tldr.tech/infosec',
   'email', 'narrative', 'INT', false, 'event-driven',
   'PR-A3 extension v129. ~100k subscribers. Curated 5-min daily digest. tier_3_curated.'),
  ('inbound_thn', 'The Hacker News (daily broad cyber)',
   'https://thehackernews.com/',
   'email', 'narrative', 'INT', false, 'event-driven',
   'PR-A3 extension v129. Highest-volume cyber-news site. tier_3_curated. Higher noise than SANS.'),
  ('inbound_securityweek', 'SecurityWeek Daily Briefing',
   'https://www.securityweek.com/newsletter/',
   'email', 'narrative', 'INT', false, 'event-driven',
   'PR-A3 extension v129. Polished editorial roundup. tier_3_curated.')
ON CONFLICT (slug) DO NOTHING;
