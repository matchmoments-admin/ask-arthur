-- Migration v282: merge_org_settings — race-safe single-key writes into organizations.settings
--
-- organizations.settings became a multi-writer jsonb column (brand_billing
-- v207-era, document_billing PR #1033): the read-modify-write pattern
-- ({...settings, key: record} from the app) loses updates when two
-- subscription events for DIFFERENT products land concurrently — whichever
-- UPDATE commits last writes back a snapshot missing the other product's
-- fresh record, silently deleting a paid entitlement.
--
-- This RPC confines each write to its own key with jsonb_set, evaluated
-- atomically inside the UPDATE — concurrent writers to different keys can
-- no longer clobber each other (same-key writers remain last-write-wins,
-- correct for a single subscription lineage). The document_billing writers
-- adopt it now; migrating the brand_billing writers is a follow-up (their
-- race pre-exists this PR).
--
-- Service-role only: the callers are the Stripe webhook + founder tooling.

CREATE OR REPLACE FUNCTION public.merge_org_settings(
  p_org_id UUID,
  p_key TEXT,
  p_value JSONB
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  UPDATE public.organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ARRAY[p_key], p_value),
      updated_at = NOW()
  WHERE id = p_org_id
  RETURNING TRUE;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_org_settings(UUID, TEXT, JSONB)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_org_settings(UUID, TEXT, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.merge_org_settings(UUID, TEXT, JSONB) IS
  'Race-safe single-key write into organizations.settings (jsonb_set inside one UPDATE). Returns TRUE when the org exists, NULL otherwise. Callers: Stripe webhook document_billing writers (v282); brand_billing writers are a planned follow-up.';
