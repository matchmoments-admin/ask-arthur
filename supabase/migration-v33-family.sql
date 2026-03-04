-- Migration v33: Family protection plan
-- Phase E3: Family groups, members, and activity log

CREATE TABLE IF NOT EXISTS family_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  max_members INT NOT NULL DEFAULT 6,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invite_code TEXT UNIQUE,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_activity_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  member_id UUID REFERENCES family_members(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_family_members_group
  ON family_members (group_id);

CREATE INDEX IF NOT EXISTS idx_family_members_user
  ON family_members (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_family_members_invite
  ON family_members (invite_code)
  WHERE invite_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_family_activity_group
  ON family_activity_log (group_id, created_at DESC);

-- Ensure owner is automatically a member
CREATE OR REPLACE FUNCTION auto_add_owner_to_family()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO family_members (group_id, user_id, email, role, joined_at)
  SELECT NEW.id, NEW.owner_id, u.email, 'admin', now()
  FROM auth.users u WHERE u.id = NEW.owner_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_family_group_add_owner
  AFTER INSERT ON family_groups
  FOR EACH ROW
  EXECUTE FUNCTION auto_add_owner_to_family();

-- RLS policies
ALTER TABLE family_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_activity_log ENABLE ROW LEVEL SECURITY;

-- Owner can manage their groups
CREATE POLICY family_groups_owner ON family_groups
  FOR ALL USING (owner_id = auth.uid());

-- Members can see their group's members
CREATE POLICY family_members_read ON family_members
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );

-- Only group admins can manage members
CREATE POLICY family_members_manage ON family_members
  FOR ALL USING (
    group_id IN (
      SELECT group_id FROM family_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Members can see their group's activity
CREATE POLICY family_activity_read ON family_activity_log
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );
