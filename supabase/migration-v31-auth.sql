-- Migration v31: User auth, profiles, and RBAC.
-- Adds user_profiles table, user_id FK on api_keys, RLS policies for
-- user-scoped access, and helper RPCs for API key generation and admin seeding.

-- =============================================================================
-- Table: user_profiles — one row per auth.users entry
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  company_name  TEXT,
  billing_email TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY "Service role access user_profiles" ON user_profiles
  FOR ALL USING (auth.role() = 'service_role');

-- Users: read own profile
CREATE POLICY "Users read own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Users: update own profile (cannot change role)
CREATE POLICY "Users update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = (SELECT role FROM user_profiles WHERE id = auth.uid()));

-- =============================================================================
-- Trigger: auto-create user_profiles on signup
-- =============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''),
    COALESCE(NEW.raw_app_meta_data ->> 'role', 'user')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================================
-- Add user_id to api_keys
-- =============================================================================
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);

-- =============================================================================
-- RLS: api_keys — user-scoped policies (existing service-role policy remains)
-- =============================================================================
CREATE POLICY "Users select own api_keys" ON api_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own api_keys" ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own api_keys" ON api_keys
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own api_keys" ON api_keys
  FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- RLS: subscriptions — user-scoped SELECT (existing service-role policy remains)
-- =============================================================================
CREATE POLICY "Users select own subscriptions" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- Add FK constraint on subscriptions.user_id → auth.users
-- (column already exists from v30, just add the constraint)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'subscriptions_user_id_fkey'
      AND table_name = 'subscriptions'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- =============================================================================
-- Helper: check if a user owns a key hash (for api_usage_log RLS)
-- =============================================================================
CREATE OR REPLACE FUNCTION user_owns_key_hash(p_key_hash TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM api_keys
    WHERE key_hash = p_key_hash
      AND user_id = auth.uid()
  );
$$;

-- RLS: api_usage_log — user can SELECT rows for their own keys
CREATE POLICY "Users select own api_usage_log" ON api_usage_log
  FOR SELECT USING (user_owns_key_hash(key_hash));

-- =============================================================================
-- RPC: generate_api_key_record — creates a new API key for a user
-- Enforces max 5 active keys per user.
-- =============================================================================
CREATE OR REPLACE FUNCTION generate_api_key_record(
  p_user_id UUID,
  p_key_hash TEXT,
  p_org_name TEXT DEFAULT 'Personal'
)
RETURNS TABLE(id BIGINT, org_name TEXT, tier TEXT, daily_limit INT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_count INT;
  v_new_id BIGINT;
BEGIN
  -- Enforce max 5 active keys per user
  SELECT COUNT(*) INTO v_active_count
  FROM api_keys
  WHERE api_keys.user_id = p_user_id AND api_keys.is_active = true;

  IF v_active_count >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 active API keys per user';
  END IF;

  INSERT INTO api_keys (key_hash, org_name, user_id)
  VALUES (p_key_hash, p_org_name, p_user_id)
  RETURNING api_keys.id INTO v_new_id;

  RETURN QUERY
  SELECT ak.id, ak.org_name, ak.tier, ak.daily_limit, ak.created_at
  FROM api_keys ak
  WHERE ak.id = v_new_id;
END;
$$;

-- =============================================================================
-- RPC: set_user_admin — set or remove admin role for a user
-- =============================================================================
CREATE OR REPLACE FUNCTION set_user_admin(p_user_id UUID, p_is_admin BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_is_admin THEN
    v_role := 'admin';
  ELSE
    v_role := 'user';
  END IF;

  -- Update auth.users app_metadata
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role)
  WHERE id = p_user_id;

  -- Sync user_profiles
  UPDATE user_profiles
  SET role = v_role, updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;
