-- v207 — monitored brands (paid Brand Monitor + partnership pilots)
--        (Wave 3 of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: today the clone-watch watchlist is a static hardcoded ~150-brand array.
-- A paying customer (or a partnership pilot — police) needs to add its OWN brand
-- to be monitored. This is the cold, org-scoped registry the NRD matcher merges
-- in (behind FF_BRAND_DYNAMIC_WATCHLIST) and the brand dashboard reads.
--
-- Cold, low-write table (a row changes on signup/edit only) — safe to index.
-- Only 'verified' + active rows ever enter monitoring, so a competitor can't
-- register someone else's brand to snoop its clone list.
--
-- RLS: reuses the PROVEN production org-membership pattern (phone_footprint /
-- api_keys) — a JWT org_id claim is NOT required; membership resolves via an
-- org_members join on auth.uid(). Writes are service-role only (the
-- registration route validates ownership + drives verification first).

CREATE TABLE IF NOT EXISTS public.monitored_brands (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id                uuid NOT NULL,
  brand_name            text NOT NULL,
  brand_normalized      text NOT NULL,               -- filled app-side via brandNormalize()
  legitimate_domains    text[] NOT NULL DEFAULT '{}',
  aliases               text[] NOT NULL DEFAULT '{}',
  verification_method   text CHECK (verification_method IN ('dns_txt', 'email_domain', 'manual')),
  verification_status   text NOT NULL DEFAULT 'pending'
                          CHECK (verification_status IN ('pending', 'verified', 'failed')),
  verification_token    text,
  verified_at           timestamptz,
  plan                  text CHECK (plan IN ('brand_pilot', 'brand_monitor', 'brand_monitor_plus', 'brand_enterprise')),
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, brand_normalized)
);

-- Only verified + active rows are ever monitored — the index the matcher RPC uses.
CREATE INDEX IF NOT EXISTS idx_monitored_brands_active
  ON public.monitored_brands (brand_normalized)
  WHERE is_active AND verification_status = 'verified';

ALTER TABLE public.monitored_brands ENABLE ROW LEVEL SECURITY;

-- Org members read their org's brands (F1-proven pattern; no JWT claim needed).
DROP POLICY IF EXISTS monitored_brands_org_read ON public.monitored_brands;
CREATE POLICY monitored_brands_org_read ON public.monitored_brands
  FOR SELECT
  USING (
    org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = monitored_brands.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
    )
  );
-- Writes are service-role only (no INSERT/UPDATE/DELETE policy) — the
-- registration route validates ownership + verification before writing.

-- Matcher worklist — the verified, active brands the NRD sweep should watch, in
-- the BrandEntry shape (brand / legitimate_domains / aliases). service_role only.
CREATE OR REPLACE FUNCTION public.list_active_monitored_brands()
RETURNS TABLE (
  brand text,
  brand_normalized text,
  legitimate_domains text[],
  aliases text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT brand_name, brand_normalized, legitimate_domains, aliases
  FROM public.monitored_brands
  WHERE is_active AND verification_status = 'verified';
$$;

REVOKE EXECUTE ON FUNCTION public.list_active_monitored_brands()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_monitored_brands()
  TO service_role;

COMMENT ON TABLE public.monitored_brands IS
  'Org-scoped brand registry for paid Brand Monitor + partnership pilots (v207). Only verified+active rows are monitored. See docs/plans/clone-watch-enforcement-and-monetisation.md Wave 3.';
