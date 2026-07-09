-- v209 — Add competitor consumer scam-newsletter sources to the inbound-email
--        allowlist (Phase 1 of the Arthur's Watch newsletter plan).
--
-- Why: subscribe Arthur's inbound pipeline to the best consumer scam newsletters
-- (Which? Scam Alerts, AARP Fraud Watch, MoneySavingExpert, This Week in Scams,
-- FrankonFraud) as INTELLIGENCE — to widen the weekly-digest content aperture
-- beyond Reddit and to feed an operator "coverage-gap" digest. These are a
-- distinct source class from regulators (publishable) and security press
-- (dropped at ingest): on-mission enough to keep, but third-party editorial
-- content we must NEVER republish. They are ingested-but-never-published — rows
-- land published=false and are stamped category='competitor_intel' by the Edge
-- Function, the admin promote action refuses them, and the tier_3 drop gate is
-- bypassed for their slugs. See docs/adr/0021-competitor-intel-source-class.md
-- and docs/plans/arthurs-watch-newsletter.md.
--
-- Safe to embed: match_feed_items_narrative (the B2B /api/v1/intel/search RPC)
-- has a hardcoded source allowlist of ('scamwatch_alert','acsc','asic_investor')
-- only, so competitor_intel rows can never surface in search; and published=false
-- keeps them off the public /scam-feed. Embedding just makes them available to
-- the Phase 2/3 weekly-cohort query.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE / DROP INDEX IF
-- EXISTS / ON CONFLICT DO NOTHING. Additive only — no row rewrites.

-- 1. Extend feed_items_source_check with the 5 new slugs.
ALTER TABLE public.feed_items DROP CONSTRAINT IF EXISTS feed_items_source_check;
ALTER TABLE public.feed_items ADD CONSTRAINT feed_items_source_check
  CHECK (source = ANY (ARRAY[
    'reddit', 'user_report', 'verified_scam', 'scamwatch', 'scamwatch_alert',
    'acsc', 'asic_investor',
    'inbound_scamwatch', 'inbound_acsc', 'inbound_austrac', 'inbound_oaic',
    'inbound_afp', 'inbound_acma', 'inbound_idcare', 'inbound_auscert',
    'inbound_ftc', 'inbound_riskybiz', 'inbound_krebs', 'inbound_generic',
    'inbound_ato', 'inbound_sans', 'inbound_tldr_infosec', 'inbound_thn',
    'inbound_securityweek', 'austrac',
    -- v209 competitor-intel consumer scam newsletters:
    'inbound_which_scams', 'inbound_aarp_fraud', 'inbound_mse',
    'inbound_twis', 'inbound_frankonfraud'
  ]));

-- 2. Extend the narrative embed RPC allowlist so the new rows get Voyage-embedded
--    (available to the weekly cohort; still never search-surfaced — see header).
CREATE OR REPLACE FUNCTION public.get_unembedded_narrative_feed_items(p_limit integer DEFAULT 40)
  RETURNS TABLE(id bigint, source text, title text, description text, body_md text,
                tags text[], impersonated_brand text, category text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
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
      'austrac',
      -- v209 competitor-intel consumer scam newsletters:
      'inbound_which_scams', 'inbound_aarp_fraud', 'inbound_mse',
      'inbound_twis', 'inbound_frankonfraud'
    )
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$function$;
REVOKE ALL ON FUNCTION public.get_unembedded_narrative_feed_items(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unembedded_narrative_feed_items(int) TO service_role;

-- 3. Recreate the partial unembedded index with the expanded slug list.
DROP INDEX IF EXISTS public.idx_feed_items_unembedded_narrative;
CREATE INDEX idx_feed_items_unembedded_narrative
  ON public.feed_items (created_at DESC)
  WHERE embedding IS NULL AND source = ANY (ARRAY[
    'scamwatch_alert', 'acsc', 'asic_investor',
    'inbound_scamwatch', 'inbound_acsc', 'inbound_austrac', 'inbound_oaic',
    'inbound_afp', 'inbound_acma', 'inbound_idcare', 'inbound_auscert',
    'inbound_ftc', 'inbound_riskybiz', 'inbound_krebs', 'inbound_generic',
    'inbound_ato', 'inbound_sans', 'inbound_tldr_infosec', 'inbound_thn',
    'inbound_securityweek', 'austrac',
    'inbound_which_scams', 'inbound_aarp_fraud', 'inbound_mse',
    'inbound_twis', 'inbound_frankonfraud'
  ]);

-- 4. Seed feed_sources registry rows (enabled=false until subscribed + confirmed).
INSERT INTO public.feed_sources (slug, name, url, source_type, category, jurisdiction, enabled, poll_schedule, notes)
VALUES
  ('inbound_which_scams', 'Which? Scam Alerts', 'https://signup.which.co.uk/wlp-scamalert-newsletter',
   'email', 'narrative', 'GB', false, 'event-driven',
   'competitor_intel — UK consumer scam newsletter (the benchmark, ~500k subs). Ingest-but-never-publish per ADR-0021; informs the weekly cohort + coverage-gap digest.'),
  ('inbound_aarp_fraud', 'AARP Fraud Watch (Watchdog Alerts)', 'https://www.aarp.org/watchdogalerts',
   'email', 'narrative', 'US', false, 'event-driven',
   'competitor_intel — US over-50s fraud alerts. Ingest-but-never-publish per ADR-0021.'),
  ('inbound_mse', 'MoneySavingExpert Weekly', 'https://www.moneysavingexpert.com/site/signup/',
   'email', 'narrative', 'GB', false, 'event-driven',
   'competitor_intel — UK money newsletter with a scam section (8.5m subs). Ingest-but-never-publish per ADR-0021.'),
  ('inbound_twis', 'This Week in Scams', 'https://scams.substack.com/',
   'email', 'narrative', 'US', false, 'event-driven',
   'competitor_intel — independent US scam Substack. Ingest-but-never-publish per ADR-0021.'),
  ('inbound_frankonfraud', 'FrankonFraud', 'https://frankonfraud.com/',
   'email', 'narrative', 'US', false, 'event-driven',
   'competitor_intel — Frank McKenna fraud intel (weekly wound down Dec 2025; monitor for revival). Ingest-but-never-publish per ADR-0021.')
ON CONFLICT (slug) DO NOTHING;
