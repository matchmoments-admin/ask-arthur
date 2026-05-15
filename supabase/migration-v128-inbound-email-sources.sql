-- v128 — Inbound-email source slugs.
--
-- Why: the upcoming Cloudflare Email Routing → Worker → Supabase Edge
-- Function pipeline (PR-A3) writes raw email body text into feed_items
-- with a per-subscription source slug derived from the recipient tag
-- (e.g. mail to acsc+ingest@intel.askarthur.au → source='inbound_acsc').
-- The v97 feed_items_source_check constraint and the v97
-- get_unembedded_narrative_feed_items() RPC both hardcode the source
-- allowlist; both need extending.
--
-- Scope: pure allowlist update. No table changes. The inbound_email
-- row in feed_sources (seeded in v127) already represents the channel.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE FUNCTION.

-- ── 1. Extend feed_items_source_check ─────────────────────────────────────

ALTER TABLE public.feed_items DROP CONSTRAINT IF EXISTS feed_items_source_check;
ALTER TABLE public.feed_items ADD CONSTRAINT feed_items_source_check
  CHECK (source = ANY (ARRAY[
    -- Existing v97 slugs:
    'reddit',
    'user_report',
    'verified_scam',
    'scamwatch',         -- legacy URL-only rows
    'scamwatch_alert',   -- HTML narrative scraper
    'acsc',              -- ACSC RSS narrative scraper
    'asic_investor',     -- ASIC Moneysmart Investor Alert List
    -- New v128 inbound-email slugs (PR-A3):
    'inbound_scamwatch',
    'inbound_acsc',
    'inbound_austrac',
    'inbound_oaic',
    'inbound_afp',
    'inbound_acma',
    'inbound_idcare',
    'inbound_auscert',
    'inbound_ftc',
    'inbound_riskybiz',
    'inbound_krebs',
    'inbound_generic'    -- fallback when tag doesn't match a known subscription
  ]));

-- ── 2. Extend get_unembedded_narrative_feed_items() RPC allowlist ─────────
--
-- Same shape as v97 — only the IN-list grew. Keeping SECURITY DEFINER +
-- SET search_path = public per CLAUDE.md guidance for functions that
-- might call pgvector operators (this one doesn't yet, but the v97
-- precedent is set).

CREATE OR REPLACE FUNCTION public.get_unembedded_narrative_feed_items(
  p_limit INT DEFAULT 40
) RETURNS TABLE (
  id BIGINT,
  source TEXT,
  title TEXT,
  description TEXT,
  body_md TEXT,
  tags TEXT[],
  impersonated_brand TEXT,
  category TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, source, title, description, body_md, tags, impersonated_brand, category
  FROM public.feed_items
  WHERE embedding IS NULL
    AND source IN (
      'scamwatch_alert', 'acsc', 'asic_investor',
      'inbound_scamwatch', 'inbound_acsc', 'inbound_austrac', 'inbound_oaic',
      'inbound_afp', 'inbound_acma', 'inbound_idcare', 'inbound_auscert',
      'inbound_ftc', 'inbound_riskybiz', 'inbound_krebs', 'inbound_generic'
    )
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE ALL ON FUNCTION public.get_unembedded_narrative_feed_items(INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unembedded_narrative_feed_items(INT) TO service_role;

-- ── 3. Backfill index to cover the new slugs ──────────────────────────────
--
-- v97 created idx_feed_items_unembedded_narrative with the original 3-slug
-- WHERE clause. Drop and recreate with the expanded slug list so the
-- partial index actually covers inbound-email rows.

DROP INDEX IF EXISTS public.idx_feed_items_unembedded_narrative;
CREATE INDEX idx_feed_items_unembedded_narrative
  ON public.feed_items (created_at DESC)
  WHERE embedding IS NULL
    AND source IN (
      'scamwatch_alert', 'acsc', 'asic_investor',
      'inbound_scamwatch', 'inbound_acsc', 'inbound_austrac', 'inbound_oaic',
      'inbound_afp', 'inbound_acma', 'inbound_idcare', 'inbound_auscert',
      'inbound_ftc', 'inbound_riskybiz', 'inbound_krebs', 'inbound_generic'
    );
