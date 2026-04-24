-- Migration v79: Onboarding RPC — expand create_organization to match the
-- 8-param call site shipped in apps/web/app/api/org/create/route.ts.
--
-- Why:
--   v55 shipped a 5-param create_organization(p_user_id, p_name, p_slug,
--   p_sector, p_abn). The B2B onboarding UI was iterated in the web app to
--   also persist ABN verification state (abn_verified, abn_entity_name from
--   the ABR lookup) and the onboarder's role title, but the migration for
--   the expanded RPC was never written. Prod onboarding Step 4/4 therefore
--   fails with PostgREST PGRST202 ("Could not find the function ... in the
--   schema cache").
--
-- Compat contract:
--   - RETURNS UUID is preserved so /api/org/create does not change its
--     return-type handling.
--   - All new params are nullable with defaults so named-arg callers that
--     only pass the original 5 values still work.
--   - org_members.role_title is nullable — no backfill needed for the
--     single existing prod row (Ask Arthur owner).

BEGIN;

-- 1. Add role_title to org_members (nullable — no backfill required).
ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS role_title TEXT;

-- 2. Drop the old 5-param signature. Param-name changes cannot be done
--    in-place via CREATE OR REPLACE; you must drop and recreate.
DROP FUNCTION IF EXISTS public.create_organization(UUID, TEXT, TEXT, TEXT, TEXT);

-- 3. Recreate with the 8-param signature the web app calls.
CREATE OR REPLACE FUNCTION public.create_organization(
  p_abn              TEXT    DEFAULT NULL,
  p_abn_entity_name  TEXT    DEFAULT NULL,
  p_abn_verified     BOOLEAN DEFAULT FALSE,
  p_name             TEXT    DEFAULT NULL,
  p_owner_id         UUID    DEFAULT NULL,
  p_role_title       TEXT    DEFAULT NULL,
  p_sector           TEXT    DEFAULT NULL,
  p_slug             TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Required-field validation. Params are nullable so PostgREST named-arg
  -- calls resolve, but the values must be present at runtime.
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'p_owner_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'p_name is required' USING ERRCODE = '22004';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' THEN
    RAISE EXCEPTION 'Invalid slug format. Use lowercase letters, numbers, and hyphens.' USING ERRCODE = '22023';
  END IF;

  -- Optional ABN sanity: 11 digits if provided. Matches column-level reality
  -- and the Zod guard at the route layer.
  IF p_abn IS NOT NULL AND p_abn !~ '^\d{11}$' THEN
    RAISE EXCEPTION 'ABN must be exactly 11 digits' USING ERRCODE = '22023';
  END IF;

  INSERT INTO organizations (
    name, slug, sector, abn, abn_verified, abn_entity_name
  ) VALUES (
    p_name,
    p_slug,
    p_sector,
    p_abn,
    COALESCE(p_abn_verified, FALSE),
    p_abn_entity_name
  )
  RETURNING id INTO v_org_id;

  INSERT INTO org_members (
    org_id, user_id, role, status, accepted_at, role_title
  ) VALUES (
    v_org_id, p_owner_id, 'owner', 'active', NOW(), p_role_title
  );

  RETURN v_org_id;
END;
$$;

-- 4. Grant execute to service role + authenticated users.
GRANT EXECUTE ON FUNCTION public.create_organization(
  TEXT, TEXT, BOOLEAN, TEXT, UUID, TEXT, TEXT, TEXT
) TO service_role, authenticated;

COMMIT;
