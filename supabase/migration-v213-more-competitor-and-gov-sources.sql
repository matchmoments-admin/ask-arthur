-- v213 — Add 6 more inbound sources (Arthur's Watch source expansion).
--
-- From the 2026-07-09 newsletter-source research. Five are competitor_intel
-- (ingest-but-never-publish, ADR-0021) and one is a publishable AU regulator:
--   inbound_choice_au        competitor_intel  CHOICE (AU independent consumer)
--   inbound_nts_scams        competitor_intel  National Trading Standards Scams Team (UK)
--   inbound_cyber_safe_center competitor_intel Cyber Safe Center (global, Beehiiv)
--   inbound_fraud_hq         competitor_intel  Fraud HQ (global, Beehiiv)
--   inbound_get_safe_online  competitor_intel  Get Safe Online (UK charity — editorial, never republish)
--   inbound_wa_scamnet       tier_1_regulator  Consumer Protection WA ScamNet (AU state gov, publishable)
--
-- The competitor_intel classification is enforced in the Edge Function
-- (COMPETITOR_INTEL_SOURCES) + the admin promote guard, not the DB. This
-- migration only extends the allowlists + seeds feed_sources.
--
-- Idempotent: DROP/ADD CONSTRAINT, CREATE OR REPLACE, DROP/CREATE INDEX,
-- ON CONFLICT DO NOTHING.

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
    'inbound_which_scams', 'inbound_aarp_fraud', 'inbound_mse',
    'inbound_frankonfraud',
    -- v213:
    'inbound_choice_au', 'inbound_nts_scams', 'inbound_cyber_safe_center',
    'inbound_fraud_hq', 'inbound_get_safe_online', 'inbound_wa_scamnet'
  ]));

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
      'inbound_which_scams', 'inbound_aarp_fraud', 'inbound_mse',
      'inbound_frankonfraud',
      'inbound_choice_au', 'inbound_nts_scams', 'inbound_cyber_safe_center',
      'inbound_fraud_hq', 'inbound_get_safe_online', 'inbound_wa_scamnet'
    )
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$function$;
REVOKE ALL ON FUNCTION public.get_unembedded_narrative_feed_items(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unembedded_narrative_feed_items(int) TO service_role;

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
    'inbound_frankonfraud',
    'inbound_choice_au', 'inbound_nts_scams', 'inbound_cyber_safe_center',
    'inbound_fraud_hq', 'inbound_get_safe_online', 'inbound_wa_scamnet'
  ]);

INSERT INTO public.feed_sources (slug, name, url, source_type, category, jurisdiction, enabled, poll_schedule, notes)
VALUES
  ('inbound_choice_au', 'CHOICE — Scams, recalls & rip-offs', 'https://www.choice.com.au/promotions/scams-recalls-and-rip-offs',
   'email', 'narrative', 'AU', false, 'event-driven',
   'competitor_intel — independent AU consumer non-profit; fills the AU gap. Never republish (ADR-0021).'),
  ('inbound_nts_scams', 'National Trading Standards Scams Team — Scam Alert', 'https://eastsussex.us11.list-manage.com/subscribe?u=dafe4e690c111df03a8f7e9c1&id=72393d4c03',
   'email', 'narrative', 'GB', false, 'event-driven',
   'competitor_intel — UK NTS fortnightly; doorstep/postal/phone coverage. Never republish (ADR-0021).'),
  ('inbound_cyber_safe_center', 'Cyber Safe Center', 'https://cybersafecenter.beehiiv.com/subscribe',
   'email', 'narrative', 'INT', false, 'event-driven',
   'competitor_intel — global consumer scam/phishing weekly (Beehiiv). Never republish (ADR-0021).'),
  ('inbound_fraud_hq', 'Fraud HQ', 'https://fraudhq.beehiiv.com/subscribe',
   'email', 'narrative', 'INT', false, 'event-driven',
   'competitor_intel — global consumer-framed fraud intel (Beehiiv). Never republish (ADR-0021).'),
  ('inbound_get_safe_online', 'Get Safe Online — PROTECT!', 'https://www.getsafeonline.org/subscribe-to-our-newsletter/',
   'email', 'narrative', 'GB', false, 'event-driven',
   'competitor_intel — UK online-safety charity editorial. Never republish (ADR-0021). (Verify cadence on subscribe.)'),
  ('inbound_wa_scamnet', 'WA ScamNet', 'https://www.scamnet.wa.gov.au/scamnet/Scam_prevention-Scam_Alert_Me.htm',
   'email', 'narrative', 'AU', false, 'event-driven',
   'tier_1_regulator — Consumer Protection WA (state gov). Publishable, NOT competitor_intel.')
ON CONFLICT (slug) DO NOTHING;
