-- migration-v7: Fix verified_scams RLS policies
-- Replace broad FOR ALL policy with explicit per-operation policies
-- (Matches the working check_stats pattern)
-- Run in Supabase SQL Editor

DROP POLICY IF EXISTS "Service role can manage scams" ON verified_scams;

CREATE POLICY "Service role can select scams" ON verified_scams FOR SELECT USING (true);
CREATE POLICY "Service role can insert scams" ON verified_scams FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update scams" ON verified_scams FOR UPDATE USING (true);
CREATE POLICY "Service role can delete scams" ON verified_scams FOR DELETE USING (true);
