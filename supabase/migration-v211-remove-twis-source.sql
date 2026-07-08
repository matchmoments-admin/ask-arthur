-- v211 — Remove the This Week in Scams (inbound_twis) competitor source.
--
-- Why: trialed in v209 but the newsletter is dormant / no longer relevant.
-- Forward-only removal (v209 is left as the historical record of the trial):
-- drop the slug from the source constraint, the narrative embed RPC allowlist,
-- and the partial index; delete its feed_sources registry row and any ingested
-- feed_items rows (only the subscribe verification-code email so far). The CF
-- email-routing rule for twis@ was deleted out-of-band.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE / DROP INDEX IF
-- EXISTS / DELETE ... WHERE. NOTE: the DELETEs run FIRST so the re-created
-- CHECK constraint validates against rows that no longer include inbound_twis.

-- 0. Delete the registry row + any ingested rows (before the constraint rebuild).
DELETE FROM public.feed_items WHERE source = 'inbound_twis';
DELETE FROM public.feed_sources WHERE slug = 'inbound_twis';

-- 1. Source constraint without inbound_twis.
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
    'inbound_frankonfraud'
  ]));

-- 2. Narrative embed RPC allowlist without inbound_twis.
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
      'inbound_frankonfraud'
    )
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$function$;
REVOKE ALL ON FUNCTION public.get_unembedded_narrative_feed_items(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unembedded_narrative_feed_items(int) TO service_role;

-- 3. Partial unembedded index without inbound_twis.
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
    'inbound_frankonfraud'
  ]);
