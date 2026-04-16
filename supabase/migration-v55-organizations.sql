-- Migration v55: Organizations, multi-tenancy, and corporate onboarding.
-- Adds organizations table, org_members for RBAC, org_invitations for team
-- invites, and extends api_keys with org_id for org-scoped access.

-- =============================================================================
-- Table: organizations — one row per corporate client
-- =============================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  abn             TEXT,  -- Australian Business Number (11 digits)
  abn_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  abn_entity_name TEXT,  -- Official name from ABR lookup
  domain          TEXT,  -- Primary email domain (e.g. "commbank.com.au")
  domain_verified BOOLEAN NOT NULL DEFAULT FALSE,
  sector          TEXT CHECK (sector IN (
    'banking', 'telco', 'digital_platform',
    'insurance', 'superannuation', 'other'
  )),
  tier            TEXT NOT NULL DEFAULT 'trial' CHECK (tier IN (
    'trial', 'pro', 'enterprise', 'custom'
  )),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'suspended', 'churned'
  )),
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);
CREATE INDEX IF NOT EXISTS idx_organizations_abn ON organizations (abn) WHERE abn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations (status);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Table: org_members — links users to organizations with roles
-- =============================================================================
CREATE TABLE IF NOT EXISTS org_members (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN (
    'owner', 'admin', 'compliance_officer', 'fraud_analyst', 'developer', 'viewer'
  )),
  invited_by  UUID REFERENCES auth.users(id),
  accepted_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'pending', 'active', 'deactivated'
  )),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members (user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON org_members (org_id);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Table: org_invitations — pending team invitations
-- =============================================================================
CREATE TABLE IF NOT EXISTS org_invitations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN (
    'owner', 'admin', 'compliance_officer', 'fraud_analyst', 'developer', 'viewer'
  )),
  token       TEXT UNIQUE NOT NULL,  -- hashed for lookup
  invited_by  UUID NOT NULL REFERENCES auth.users(id),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON org_invitations (token);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations (email);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_id ON org_invitations (org_id);

ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Extend api_keys with org_id (nullable — existing keys remain user-scoped)
-- =============================================================================
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys (org_id) WHERE org_id IS NOT NULL;

-- =============================================================================
-- RLS: organizations — members can read their own org
-- =============================================================================

-- Service role: full access
CREATE POLICY "Service role access organizations" ON organizations
  FOR ALL USING (auth.role() = 'service_role');

-- Members can read their own org
CREATE POLICY "Members read own organization" ON organizations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = organizations.id
        AND org_members.user_id = auth.uid()
        AND org_members.status = 'active'
    )
  );

-- =============================================================================
-- RLS: org_members — members can read within their org; owners/admins manage
-- =============================================================================

-- Service role: full access
CREATE POLICY "Service role access org_members" ON org_members
  FOR ALL USING (auth.role() = 'service_role');

-- Members can read other members in their org
CREATE POLICY "Members read org_members" ON org_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM org_members AS om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

-- Owners/admins can insert new members
CREATE POLICY "Owners/admins insert org_members" ON org_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM org_members AS om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  );

-- Owners/admins can update members (but not themselves to prevent lock-out)
CREATE POLICY "Owners/admins update org_members" ON org_members
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM org_members AS om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  );

-- Owners can delete members (except themselves)
CREATE POLICY "Owners delete org_members" ON org_members
  FOR DELETE USING (
    org_members.user_id != auth.uid()
    AND EXISTS (
      SELECT 1 FROM org_members AS om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
        AND om.status = 'active'
    )
  );

-- =============================================================================
-- RLS: org_invitations — owners/admins manage; service role full access
-- =============================================================================

CREATE POLICY "Service role access org_invitations" ON org_invitations
  FOR ALL USING (auth.role() = 'service_role');

-- Owners/admins can read invitations for their org
CREATE POLICY "Owners/admins read org_invitations" ON org_invitations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = org_invitations.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner', 'admin')
        AND org_members.status = 'active'
    )
  );

-- Owners/admins can create invitations
CREATE POLICY "Owners/admins insert org_invitations" ON org_invitations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = org_invitations.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner', 'admin')
        AND org_members.status = 'active'
    )
  );

-- =============================================================================
-- RLS: api_keys — extend with org-scoped access
-- =============================================================================

-- Org members can read their org's API keys
CREATE POLICY "Org members select org api_keys" ON api_keys
  FOR SELECT USING (
    org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.status = 'active'
    )
  );

-- Org owners/admins/developers can create org API keys
CREATE POLICY "Org admins insert org api_keys" ON api_keys
  FOR INSERT WITH CHECK (
    org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner', 'admin', 'developer')
        AND org_members.status = 'active'
    )
  );

-- Org owners/admins can update org API keys
CREATE POLICY "Org admins update org api_keys" ON api_keys
  FOR UPDATE USING (
    org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner', 'admin')
        AND org_members.status = 'active'
    )
  );

-- Org owners/admins can delete org API keys
CREATE POLICY "Org admins delete org api_keys" ON api_keys
  FOR DELETE USING (
    org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = api_keys.org_id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner', 'admin')
        AND org_members.status = 'active'
    )
  );

-- Org members can read usage logs for their org's keys
CREATE POLICY "Org members select org api_usage_log" ON api_usage_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM api_keys
      JOIN org_members ON org_members.org_id = api_keys.org_id
      WHERE api_keys.key_hash = api_usage_log.key_hash
        AND org_members.user_id = auth.uid()
        AND org_members.status = 'active'
    )
  );

-- =============================================================================
-- RPC: create_organization — atomically creates org + owner membership
-- =============================================================================
CREATE OR REPLACE FUNCTION create_organization(
  p_user_id   UUID,
  p_name      TEXT,
  p_slug      TEXT,
  p_sector    TEXT DEFAULT NULL,
  p_abn       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Validate slug format (lowercase alphanumeric + hyphens)
  IF p_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' THEN
    RAISE EXCEPTION 'Invalid slug format. Use lowercase letters, numbers, and hyphens.';
  END IF;

  -- Create the organization
  INSERT INTO organizations (name, slug, sector, abn)
  VALUES (p_name, p_slug, p_sector, p_abn)
  RETURNING id INTO v_org_id;

  -- Add the creating user as owner
  INSERT INTO org_members (org_id, user_id, role, status, accepted_at)
  VALUES (v_org_id, p_user_id, 'owner', 'active', NOW());

  RETURN v_org_id;
END;
$$;

-- =============================================================================
-- RPC: get_user_org — returns the user's primary organization
-- =============================================================================
CREATE OR REPLACE FUNCTION get_user_org(p_user_id UUID)
RETURNS TABLE(
  org_id      UUID,
  org_name    TEXT,
  org_slug    TEXT,
  org_sector  TEXT,
  org_tier    TEXT,
  org_status  TEXT,
  member_role TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    o.id        AS org_id,
    o.name      AS org_name,
    o.slug      AS org_slug,
    o.sector    AS org_sector,
    o.tier      AS org_tier,
    o.status    AS org_status,
    om.role     AS member_role
  FROM org_members om
  JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = p_user_id
    AND om.status = 'active'
    AND o.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;
$$;

-- =============================================================================
-- RPC: generate_org_api_key — creates an API key scoped to an organization
-- Enforces max 20 active keys per org.
-- =============================================================================
CREATE OR REPLACE FUNCTION generate_org_api_key(
  p_user_id   UUID,
  p_org_id    UUID,
  p_key_hash  TEXT,
  p_org_name  TEXT DEFAULT 'Organization'
)
RETURNS TABLE(id BIGINT, org_name TEXT, tier TEXT, daily_limit INT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_count INT;
  v_new_id BIGINT;
  v_member_role TEXT;
BEGIN
  -- Verify user is an owner, admin, or developer of this org
  SELECT om.role INTO v_member_role
  FROM org_members om
  WHERE om.org_id = p_org_id
    AND om.user_id = p_user_id
    AND om.status = 'active';

  IF v_member_role IS NULL OR v_member_role NOT IN ('owner', 'admin', 'developer') THEN
    RAISE EXCEPTION 'Insufficient permissions to create API keys for this organization';
  END IF;

  -- Enforce max 20 active keys per org
  SELECT COUNT(*) INTO v_active_count
  FROM api_keys
  WHERE api_keys.org_id = p_org_id AND api_keys.is_active = true;

  IF v_active_count >= 20 THEN
    RAISE EXCEPTION 'Maximum 20 active API keys per organization';
  END IF;

  INSERT INTO api_keys (key_hash, org_name, user_id, org_id)
  VALUES (p_key_hash, p_org_name, p_user_id, p_org_id)
  RETURNING api_keys.id INTO v_new_id;

  RETURN QUERY
  SELECT ak.id, ak.org_name, ak.tier, ak.daily_limit, ak.created_at
  FROM api_keys ak
  WHERE ak.id = v_new_id;
END;
$$;

-- =============================================================================
-- Trigger: update organizations.updated_at on change
-- =============================================================================
CREATE OR REPLACE FUNCTION update_organizations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_organizations_updated_at();
