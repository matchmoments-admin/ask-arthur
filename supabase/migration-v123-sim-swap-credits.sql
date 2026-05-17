-- Migration v123: SIM Swap on-demand check — credits, ledger, beta invites, RPC.
--
-- Ships the schema primitives for the Telstra-direct SIM Swap on-demand
-- product (web + mobile clients hitting POST /api/sim-swap/check):
--
--   sim_swap_credits         — 1 free check / user / calendar month + paid bucket
--   sim_swap_credit_ledger   — audit trail (purchases, consumptions, refunds)
--   sim_swap_beta_invites    — invite-gating for the web private beta
--   consume_sim_swap_credit  — atomic decrement RPC (free first, then paid)
--
-- Idempotent: every CREATE uses IF NOT EXISTS / OR REPLACE; safe to re-apply.
-- RLS pattern mirrors v75 (phone-footprint core): service-role full,
-- user-scoped SELECT/UPDATE on the credits row, ledger is read-only to the
-- owner (writes only via the RPC + Stripe webhook running as service role).
--
-- Pricing model (locked 2026-05-15):
--   Verified free user — 1 check/number/month. Beyond that, $0.99 5-pack.
--   Recovery flow (user can't OTP because SIM is gone) — $4.99 KYC-gated.
--   Partner B2B — per-call API, separate auth path, bypasses credit table.
--
-- The RPC uses #variable_conflict use_column + an explicit search_path per
-- the PL/pgSQL function gotchas documented in CLAUDE.md (2026-05-06 bites).

-- =============================================================================
-- Table: sim_swap_credits — per-user monthly bucket
-- =============================================================================
CREATE TABLE IF NOT EXISTS sim_swap_credits (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start       DATE NOT NULL DEFAULT date_trunc('month', NOW())::DATE,
  free_remaining     SMALLINT NOT NULL DEFAULT 1 CHECK (free_remaining >= 0),
  paid_remaining     INTEGER  NOT NULL DEFAULT 0 CHECK (paid_remaining >= 0),
  recovery_remaining SMALLINT NOT NULL DEFAULT 0 CHECK (recovery_remaining >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN sim_swap_credits.free_remaining IS
  'Resets to 1 on the first call in a new calendar month via consume_sim_swap_credit RPC.';

-- =============================================================================
-- Table: sim_swap_credit_ledger — append-only audit trail
-- =============================================================================
CREATE TABLE IF NOT EXISTS sim_swap_credit_ledger (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  bucket      TEXT NOT NULL CHECK (bucket IN ('free','paid','recovery')),
  reason      TEXT NOT NULL CHECK (reason IN (
    'monthly_reset','purchase_5pack','purchase_recovery',
    'consume_check','consume_recovery','refund','admin_adjust'
  )),
  stripe_ref  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sscl_user_created
  ON sim_swap_credit_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sscl_stripe_ref
  ON sim_swap_credit_ledger (stripe_ref)
  WHERE stripe_ref IS NOT NULL;

-- =============================================================================
-- Table: sim_swap_beta_invites — web private-beta gating
-- =============================================================================
CREATE TABLE IF NOT EXISTS sim_swap_beta_invites (
  invite_code TEXT PRIMARY KEY,
  email       TEXT,                                            -- lowercased on insert
  redeemed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  created_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ssbi_email_unredeemed
  ON sim_swap_beta_invites (email)
  WHERE redeemed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ssbi_redeemed_by
  ON sim_swap_beta_invites (redeemed_by)
  WHERE redeemed_by IS NOT NULL;

-- =============================================================================
-- RPC: consume_sim_swap_credit — atomic, monthly-reset-aware decrement
-- =============================================================================
-- Returns the bucket consumed + remaining counters so the caller can render
-- "X free checks left" without a second round-trip.
--
-- Raises 'no_credits' (SQLSTATE P0001) when both free and paid are zero — the
-- caller maps that to a 402 Payment Required + upsell.
--
-- The recovery_remaining bucket is consumed via consume_sim_swap_recovery
-- (separate RPC, deferred to Phase 1 endpoint PR — recovery flow needs KYC
-- gating beyond what this RPC handles).
CREATE OR REPLACE FUNCTION consume_sim_swap_credit(p_user_id UUID)
RETURNS TABLE (
  consumed_bucket  TEXT,
  free_remaining   SMALLINT,
  paid_remaining   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_period_start DATE;
  v_this_month   DATE := date_trunc('month', NOW())::DATE;
  v_free         SMALLINT;
  v_paid         INTEGER;
BEGIN
  -- Ensure a row exists for the user.
  INSERT INTO sim_swap_credits(user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

  -- Lock the row for the rest of this transaction.
  SELECT period_start, free_remaining, paid_remaining
    INTO v_period_start, v_free, v_paid
    FROM sim_swap_credits
   WHERE user_id = p_user_id
   FOR UPDATE;

  -- Monthly reset — performed lazily on first call of a new calendar month.
  IF v_period_start < v_this_month THEN
    UPDATE sim_swap_credits
       SET period_start   = v_this_month,
           free_remaining = 1,
           updated_at     = NOW()
     WHERE user_id = p_user_id;
    INSERT INTO sim_swap_credit_ledger(user_id, delta, bucket, reason)
      VALUES (p_user_id, 1, 'free', 'monthly_reset');
    v_free := 1;
  END IF;

  IF v_free > 0 THEN
    UPDATE sim_swap_credits
       SET free_remaining = free_remaining - 1,
           updated_at     = NOW()
     WHERE user_id = p_user_id;
    INSERT INTO sim_swap_credit_ledger(user_id, delta, bucket, reason)
      VALUES (p_user_id, -1, 'free', 'consume_check');
    RETURN QUERY SELECT 'free'::TEXT, (v_free - 1)::SMALLINT, v_paid;
    RETURN;
  END IF;

  IF v_paid > 0 THEN
    UPDATE sim_swap_credits
       SET paid_remaining = paid_remaining - 1,
           updated_at     = NOW()
     WHERE user_id = p_user_id;
    INSERT INTO sim_swap_credit_ledger(user_id, delta, bucket, reason)
      VALUES (p_user_id, -1, 'paid', 'consume_check');
    RETURN QUERY SELECT 'paid'::TEXT, v_free, (v_paid - 1);
    RETURN;
  END IF;

  RAISE EXCEPTION 'no_credits' USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION consume_sim_swap_credit(UUID) IS
  'Atomic credit decrement with lazy monthly reset. Raises SQLSTATE P0001 ''no_credits'' when both buckets are empty.';

-- =============================================================================
-- RLS — service-role full + user-scoped read on credits/ledger
-- =============================================================================
ALTER TABLE sim_swap_credits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_swap_credit_ledger    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_swap_beta_invites     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role access sim_swap_credits" ON sim_swap_credits;
CREATE POLICY "Service role access sim_swap_credits" ON sim_swap_credits
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own sim_swap_credits" ON sim_swap_credits;
CREATE POLICY "Users read own sim_swap_credits" ON sim_swap_credits
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Service role access sim_swap_credit_ledger" ON sim_swap_credit_ledger;
CREATE POLICY "Service role access sim_swap_credit_ledger" ON sim_swap_credit_ledger
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own sim_swap_credit_ledger" ON sim_swap_credit_ledger;
CREATE POLICY "Users read own sim_swap_credit_ledger" ON sim_swap_credit_ledger
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Service role access sim_swap_beta_invites" ON sim_swap_beta_invites;
CREATE POLICY "Service role access sim_swap_beta_invites" ON sim_swap_beta_invites
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own beta invite" ON sim_swap_beta_invites;
CREATE POLICY "Users read own beta invite" ON sim_swap_beta_invites
  FOR SELECT USING (redeemed_by = (SELECT auth.uid()));

-- =============================================================================
-- Grants — anon/auth role cannot call the RPC; only service role.
-- =============================================================================
-- Endpoint runs under the service role (createServiceClient) so it can call
-- consume_sim_swap_credit. We explicitly revoke from anon/authenticated to
-- prevent a future RLS slip from letting a client call the RPC directly.
REVOKE EXECUTE ON FUNCTION consume_sim_swap_credit(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION consume_sim_swap_credit(UUID) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION consume_sim_swap_credit(UUID) TO service_role;
