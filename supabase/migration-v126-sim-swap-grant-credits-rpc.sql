-- Migration v126: grant_sim_swap_credits RPC for Stripe Checkout completion.
--
-- Called by /apps/web/app/api/stripe/webhook/route.ts when a one-time
-- SIM Swap credit purchase completes. Atomic insert-or-update + ledger
-- write, mirroring the consume + refund RPCs in v123 + v125.
--
-- Pricing model (locked 2026-05-15):
--   sim_swap_credits_5pack   → bucket='paid',     credits=5   for AUD $0.99
--   sim_swap_recovery_check  → bucket='recovery', credits=1   for AUD $4.99
--
-- Idempotency: the webhook checks for an existing ledger row keyed by
-- stripe_ref (payment_intent) BEFORE calling this RPC, so the RPC itself
-- doesn't need to dedupe. We could add UNIQUE INDEX on stripe_ref as a
-- defensive double-check, but webhook-level dedupe is already in place.

CREATE OR REPLACE FUNCTION grant_sim_swap_credits(
  p_user_id    UUID,
  p_bucket     TEXT,
  p_credits    INTEGER,
  p_reason     TEXT,
  p_stripe_ref TEXT
)
RETURNS TABLE (
  free_remaining     SMALLINT,
  paid_remaining     INTEGER,
  recovery_remaining SMALLINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_free  SMALLINT;
  v_paid  INTEGER;
  v_rec   SMALLINT;
BEGIN
  IF p_bucket NOT IN ('paid', 'recovery') THEN
    RAISE EXCEPTION 'invalid_bucket' USING ERRCODE = 'P0001';
  END IF;
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'invalid_credits' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason NOT IN ('purchase_5pack', 'purchase_recovery', 'admin_adjust') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;

  -- Insert-if-missing — first-time purchasers don't have a credits row yet.
  INSERT INTO sim_swap_credits(user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

  -- Lock then increment.
  PERFORM 1 FROM sim_swap_credits WHERE user_id = p_user_id FOR UPDATE;

  IF p_bucket = 'paid' THEN
    UPDATE sim_swap_credits
       SET paid_remaining = paid_remaining + p_credits,
           updated_at     = NOW()
     WHERE user_id = p_user_id
     RETURNING free_remaining, paid_remaining, recovery_remaining
       INTO v_free, v_paid, v_rec;
  ELSE
    UPDATE sim_swap_credits
       SET recovery_remaining = recovery_remaining + p_credits,
           updated_at         = NOW()
     WHERE user_id = p_user_id
     RETURNING free_remaining, paid_remaining, recovery_remaining
       INTO v_free, v_paid, v_rec;
  END IF;

  INSERT INTO sim_swap_credit_ledger(user_id, delta, bucket, reason, stripe_ref)
    VALUES (p_user_id, p_credits, p_bucket, p_reason, p_stripe_ref);

  RETURN QUERY SELECT v_free, v_paid, v_rec;
END;
$$;

COMMENT ON FUNCTION grant_sim_swap_credits(UUID, TEXT, INTEGER, TEXT, TEXT) IS
  'Adds credits to a user''s sim_swap_credits bucket + writes a ledger row, atomically. Called from the Stripe webhook on checkout.session.completed for one-time SIM Swap SKUs.';

REVOKE EXECUTE ON FUNCTION grant_sim_swap_credits(UUID, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION grant_sim_swap_credits(UUID, TEXT, INTEGER, TEXT, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION grant_sim_swap_credits(UUID, TEXT, INTEGER, TEXT, TEXT) TO service_role;
