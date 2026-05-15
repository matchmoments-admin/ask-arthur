-- Migration v125: SIM Swap credit refund RPC.
--
-- Companion to v123's consume_sim_swap_credit. Returns a credit to the
-- bucket it came from when an upstream call fails (Telstra 5xx, network
-- timeout, etc.). Mirrors the consume RPC's atomicity guarantees:
-- SECURITY DEFINER, FOR UPDATE row lock, ledger write.
--
-- Pricing rule: user pays for a *successful* Telstra check. Network /
-- carrier-side failures shouldn't drain their bucket — the endpoint
-- calls refund_sim_swap_credit immediately after recording the failure.
--
-- Two scenarios where refund is called:
--   1. Telstra returns 5xx / network error (provider raised an exception).
--   2. Telstra returns `kind: 'degraded'` for "not a Telstra subscriber" —
--      this isn't a successful read of swap state, just a "we don't know"
--      response, so the user shouldn't be billed.
--
-- Idempotent re-apply: drop-then-add on the CHECK constraint + CREATE OR
-- REPLACE on the function.

-- Expand the reason CHECK to admit the upstream-specific refund reasons.
-- 'refund' (bare) is kept for admin-issued refunds via the dashboard;
-- the *_telstra_* variants give us forensic clarity per the v123 audit
-- trail intent (we want to know WHY a refund landed).
ALTER TABLE sim_swap_credit_ledger
  DROP CONSTRAINT IF EXISTS sim_swap_credit_ledger_reason_check;
ALTER TABLE sim_swap_credit_ledger
  ADD CONSTRAINT sim_swap_credit_ledger_reason_check
    CHECK (reason IN (
      'monthly_reset',
      'purchase_5pack',
      'purchase_recovery',
      'consume_check',
      'consume_recovery',
      'refund',
      'refund_telstra_5xx',
      'refund_telstra_degraded',
      'admin_adjust'
    ));

CREATE OR REPLACE FUNCTION refund_sim_swap_credit(
  p_user_id UUID,
  p_bucket  TEXT,
  p_reason  TEXT DEFAULT 'refund'
)
RETURNS TABLE (
  free_remaining   SMALLINT,
  paid_remaining   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_free SMALLINT;
  v_paid INTEGER;
BEGIN
  IF p_bucket NOT IN ('free','paid','recovery') THEN
    RAISE EXCEPTION 'invalid_bucket' USING ERRCODE = 'P0001';
  END IF;

  -- Row must already exist (the consume RPC creates it). If it doesn't,
  -- we surface that as an error rather than silently inserting — a
  -- refund without a prior consume is a logic bug worth catching.
  PERFORM 1 FROM sim_swap_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_credits_row' USING ERRCODE = 'P0001';
  END IF;

  IF p_bucket = 'free' THEN
    UPDATE sim_swap_credits
       SET free_remaining = free_remaining + 1,
           updated_at     = NOW()
     WHERE user_id = p_user_id
     RETURNING free_remaining, paid_remaining INTO v_free, v_paid;
  ELSIF p_bucket = 'paid' THEN
    UPDATE sim_swap_credits
       SET paid_remaining = paid_remaining + 1,
           updated_at     = NOW()
     WHERE user_id = p_user_id
     RETURNING free_remaining, paid_remaining INTO v_free, v_paid;
  ELSE
    UPDATE sim_swap_credits
       SET recovery_remaining = recovery_remaining + 1,
           updated_at         = NOW()
     WHERE user_id = p_user_id
     RETURNING free_remaining, paid_remaining INTO v_free, v_paid;
  END IF;

  INSERT INTO sim_swap_credit_ledger(user_id, delta, bucket, reason)
    VALUES (p_user_id, 1, p_bucket, p_reason);

  RETURN QUERY SELECT v_free, v_paid;
END;
$$;

COMMENT ON FUNCTION refund_sim_swap_credit(UUID, TEXT, TEXT) IS
  'Returns a credit to the named bucket atomically + writes a ledger row. Reason should be ''refund'' (default), ''refund_telstra_5xx'', or ''refund_telstra_degraded''.';

REVOKE EXECUTE ON FUNCTION refund_sim_swap_credit(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refund_sim_swap_credit(UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION refund_sim_swap_credit(UUID, TEXT, TEXT) TO service_role;
