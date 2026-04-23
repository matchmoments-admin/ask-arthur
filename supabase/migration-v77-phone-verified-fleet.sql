-- Migration v77: Phone verification on user_profiles + fleet columns on
-- organizations + RLS perf fixes for v75/v76.
--
-- Three concerns bundled:
--
-- 1. `user_profiles.phone_e164` + `phone_e164_hash` + `phone_verified_at`:
--    Record of ownership proof that survives across sessions. Once a user
--    verifies a phone via Twilio Verify OTP, we stamp `phone_verified_at` and
--    the paid-tier self-lookup route can skip re-OTP as long as the stamp is
--    fresh (configurable, default 30 days). Hash column is for cross-MSISDN
--    enumeration detection without exposing the plaintext E.164.
--
-- 2. `organizations.fleet_*`: carries the Fleet Starter / Enterprise
--    entitlement per-org. Seat cap is stored denormalised here (not derived
--    from phone_footprint_entitlements.saved_numbers_limit) because fleet
--    billing is per-org-seat, not per-user-monitor. Webhook URL + encrypted
--    secret carry the CAMARA alert delivery target; decrypt is app-layer.
--
-- 3. RLS `auth_rls_initplan` perf: every v75/v76 policy that called
--    `auth.role()` or `auth.uid()` raw. Postgres planner re-evaluates these
--    per-row; wrapping in `(SELECT auth.role())` lets it evaluate once per
--    query. Supabase's perf advisor flagged 64 instances; this migration
--    fixes all of them idempotently (DROP + CREATE).

-- =============================================================================
-- 1. user_profiles phone columns
-- =============================================================================
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS phone_e164         TEXT,
  ADD COLUMN IF NOT EXISTS phone_e164_hash    TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified_at  TIMESTAMPTZ;

-- A user can only bind one phone at a time; re-binding bumps the unique row.
-- Partial unique — null phone is allowed (majority state during Sprint 1-2).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_phone_hash
  ON user_profiles (phone_e164_hash)
  WHERE phone_e164_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_phone_verified
  ON user_profiles (phone_verified_at DESC)
  WHERE phone_verified_at IS NOT NULL;

-- =============================================================================
-- 2. organizations fleet columns
-- =============================================================================
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS fleet_tier             TEXT
    CHECK (fleet_tier IN ('none','fleet_starter','fleet_pro','fleet_enterprise'))
    DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS fleet_seat_cap         INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fleet_webhook_url      TEXT,
  ADD COLUMN IF NOT EXISTS fleet_webhook_secret   TEXT,  -- AES-GCM at rest; decrypt app-side
  ADD COLUMN IF NOT EXISTS fleet_refresh_interval INTERVAL DEFAULT INTERVAL '30 days';

CREATE INDEX IF NOT EXISTS idx_organizations_fleet_tier
  ON organizations (fleet_tier)
  WHERE fleet_tier IS NOT NULL AND fleet_tier <> 'none';

-- Helper: enforce seat cap on monitor insert. Raises if the org is at or
-- over its cap. Called by API layer before inserting a fleet monitor.
CREATE OR REPLACE FUNCTION assert_fleet_capacity(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap   INT;
  v_used  INT;
BEGIN
  SELECT fleet_seat_cap INTO v_cap
  FROM organizations
  WHERE id = p_org_id;

  SELECT COUNT(*) INTO v_used
  FROM phone_footprint_monitors
  WHERE org_id = p_org_id
    AND status = 'active'
    AND soft_deleted_at IS NULL;

  IF v_used >= COALESCE(v_cap, 0) THEN
    RAISE EXCEPTION 'Fleet seat cap reached (% of %) for org %', v_used, v_cap, p_org_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION assert_fleet_capacity(UUID) TO service_role;

-- =============================================================================
-- 3. RLS perf fixes (auth_rls_initplan) for v75 + v76 policies
-- =============================================================================
-- For each policy that calls auth.role() or auth.uid() raw, drop and recreate
-- it with the (SELECT ...) wrapper so Postgres caches the evaluation.

-- --- phone_footprints
DROP POLICY IF EXISTS "Service role access phone_footprints" ON phone_footprints;
CREATE POLICY "Service role access phone_footprints" ON phone_footprints
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Users read own phone_footprints" ON phone_footprints;
CREATE POLICY "Users read own phone_footprints" ON phone_footprints
  FOR SELECT USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Org members read phone_footprints" ON phone_footprints;
CREATE POLICY "Org members read phone_footprints" ON phone_footprints
  FOR SELECT USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprints.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
    )
  );

-- --- phone_footprint_monitors
DROP POLICY IF EXISTS "Service role access phone_footprint_monitors" ON phone_footprint_monitors;
CREATE POLICY "Service role access phone_footprint_monitors" ON phone_footprint_monitors
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Users manage own phone_footprint_monitors" ON phone_footprint_monitors;
CREATE POLICY "Users manage own phone_footprint_monitors" ON phone_footprint_monitors
  FOR ALL USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Org members read fleet monitors" ON phone_footprint_monitors;
CREATE POLICY "Org members read fleet monitors" ON phone_footprint_monitors
  FOR SELECT USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
    )
  );
DROP POLICY IF EXISTS "Org staff write fleet monitors" ON phone_footprint_monitors;
CREATE POLICY "Org staff write fleet monitors" ON phone_footprint_monitors
  FOR ALL USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role IN ('owner','admin','fraud_analyst','compliance_officer')
        AND m.status = 'active'
    )
  )
  WITH CHECK (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprint_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role IN ('owner','admin','fraud_analyst','compliance_officer')
        AND m.status = 'active'
    )
  );

-- --- phone_footprint_alerts
DROP POLICY IF EXISTS "Service role access phone_footprint_alerts" ON phone_footprint_alerts;
CREATE POLICY "Service role access phone_footprint_alerts" ON phone_footprint_alerts
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Users read own alerts" ON phone_footprint_alerts;
CREATE POLICY "Users read own alerts" ON phone_footprint_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM phone_footprint_monitors m
      WHERE m.id = phone_footprint_alerts.monitor_id
        AND (
          m.user_id = (SELECT auth.uid()) OR
          (m.org_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = m.org_id
              AND om.user_id = (SELECT auth.uid())
              AND om.status = 'active'
          ))
        )
    )
  );

-- --- phone_footprint_refresh_queue (service role only)
DROP POLICY IF EXISTS "Service role access phone_footprint_refresh_queue" ON phone_footprint_refresh_queue;
CREATE POLICY "Service role access phone_footprint_refresh_queue" ON phone_footprint_refresh_queue
  FOR ALL USING ((SELECT auth.role()) = 'service_role');

-- --- phone_footprint_entitlements
DROP POLICY IF EXISTS "Service role access phone_footprint_entitlements" ON phone_footprint_entitlements;
CREATE POLICY "Service role access phone_footprint_entitlements" ON phone_footprint_entitlements
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Users read own entitlements" ON phone_footprint_entitlements;
CREATE POLICY "Users read own entitlements" ON phone_footprint_entitlements
  FOR SELECT USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Org admins read org entitlements" ON phone_footprint_entitlements;
CREATE POLICY "Org admins read org entitlements" ON phone_footprint_entitlements
  FOR SELECT USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = phone_footprint_entitlements.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role IN ('owner','admin')
        AND m.status = 'active'
    )
  );

-- --- phone_footprint_otp_attempts (service role only)
DROP POLICY IF EXISTS "Service role access phone_footprint_otp_attempts" ON phone_footprint_otp_attempts;
CREATE POLICY "Service role access phone_footprint_otp_attempts" ON phone_footprint_otp_attempts
  FOR ALL USING ((SELECT auth.role()) = 'service_role');

-- --- sim_swap_monitors
DROP POLICY IF EXISTS "Service role access sim_swap_monitors" ON sim_swap_monitors;
CREATE POLICY "Service role access sim_swap_monitors" ON sim_swap_monitors
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Org admins read sim_swap_monitors" ON sim_swap_monitors;
CREATE POLICY "Org admins read sim_swap_monitors" ON sim_swap_monitors
  FOR SELECT USING (
    org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = sim_swap_monitors.org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role IN ('owner','admin','fraud_analyst','compliance_officer')
        AND m.status = 'active'
    )
  );
DROP POLICY IF EXISTS "Users read own sim_swap_monitors" ON sim_swap_monitors;
CREATE POLICY "Users read own sim_swap_monitors" ON sim_swap_monitors
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- --- sim_swap_events, device_swap_events, subscriber_match_checks (service role only)
DROP POLICY IF EXISTS "Service role access sim_swap_events" ON sim_swap_events;
CREATE POLICY "Service role access sim_swap_events" ON sim_swap_events
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Service role access device_swap_events" ON device_swap_events;
CREATE POLICY "Service role access device_swap_events" ON device_swap_events
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Service role access subscriber_match_checks" ON subscriber_match_checks;
CREATE POLICY "Service role access subscriber_match_checks" ON subscriber_match_checks
  FOR ALL USING ((SELECT auth.role()) = 'service_role');

-- --- telco_signal_history, telco_api_usage, telco_webhook_subscriptions, telco_provider_health
DROP POLICY IF EXISTS "Service role access telco_signal_history" ON telco_signal_history;
CREATE POLICY "Service role access telco_signal_history" ON telco_signal_history
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Service role access telco_api_usage" ON telco_api_usage;
CREATE POLICY "Service role access telco_api_usage" ON telco_api_usage
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Service role access telco_webhook_subscriptions" ON telco_webhook_subscriptions;
CREATE POLICY "Service role access telco_webhook_subscriptions" ON telco_webhook_subscriptions
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
DROP POLICY IF EXISTS "Service role access telco_provider_health" ON telco_provider_health;
CREATE POLICY "Service role access telco_provider_health" ON telco_provider_health
  FOR ALL USING ((SELECT auth.role()) = 'service_role');
