-- migration-v235-clone-campaign-fingerprint.sql
--
-- Campaign fingerprinting: a coarse actor key over the infrastructure
-- attributes already stored per clone alert (registrar + nameserver operator +
-- hosting ASN + cert issuer). Lets us answer "N of your lookalikes appear to be
-- ONE coordinated campaign" — the cross-alert story brands / SPF buyers want.
--
-- The key is computed in TS (apps/web/lib/clone-watch/campaign-fingerprint.ts)
-- so it reuses canonicalRegistrar() — the single registrar-folding home — and
-- is NEVER recomputed in SQL (the one-formula-one-home rule). This migration
-- just persists the column + a lookup RPC that GROUPs on it.
--
-- shopfront_clone_alerts is service-role-only and not on the hot-table list; a
-- single small partial btree is within the index budget.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE). Reverse: DROP COLUMN
-- campaign_key + DROP FUNCTION (no data loss — the key is derived).

ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS campaign_key text;

COMMENT ON COLUMN public.shopfront_clone_alerts.campaign_key IS
  'Coarse actor fingerprint (sha256[:16] of canonical registrar + NS roots + ASN + cert issuer). Computed by campaign-fingerprint.ts — NEVER recompute in SQL. Sentinel ''insufficient'' = too few attributes to cluster.';

-- Real campaigns only (exclude the null/insufficient buckets).
CREATE INDEX IF NOT EXISTS idx_clone_alerts_campaign_key
  ON public.shopfront_clone_alerts (campaign_key)
  WHERE campaign_key IS NOT NULL AND campaign_key <> 'insufficient';

-- Admin/internal: campaigns (≥2 domains sharing a key) targeting a brand in a
-- window. SECURITY DEFINER + empty search_path + service_role-only, matching
-- the v203 brand-exposure posture.
CREATE OR REPLACE FUNCTION public.clone_campaigns_for_brand(
  p_brand_normalized text,
  p_since timestamptz,
  p_until timestamptz
)
RETURNS TABLE (
  campaign_key text,
  domain_count integer,
  first_seen timestamptz,
  last_seen timestamptz,
  weaponised_count integer,
  registrar text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    sca.campaign_key,
    count(*)::int AS domain_count,
    min(sca.first_seen_at) AS first_seen,
    max(sca.last_seen_at) AS last_seen,
    count(*) FILTER (WHERE sca.weaponised_at IS NOT NULL)::int AS weaponised_count,
    max(sca.attribution->'whois'->>'registrar') AS registrar
  FROM public.shopfront_clone_alerts sca
  WHERE sca.target_brand_normalized = p_brand_normalized
    AND sca.campaign_key IS NOT NULL
    AND sca.campaign_key <> 'insufficient'
    AND sca.first_seen_at >= p_since
    AND sca.first_seen_at < p_until
  GROUP BY sca.campaign_key
  HAVING count(*) >= 2
  ORDER BY count(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.clone_campaigns_for_brand(text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_campaigns_for_brand(text, timestamptz, timestamptz)
  TO service_role;
