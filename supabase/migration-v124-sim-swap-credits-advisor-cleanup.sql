-- Migration v124: SIM Swap credits — advisor cleanup follow-up to v123.
--
-- Two clean-ups against the new tables introduced in v123:
--
--   1. Drop the three service-role-only PERMISSIVE policies. Per the
--      precedent set in v107 (multiple-permissive-policy consolidation),
--      these policies are functionally dead: service_role bypasses RLS
--      anyway, and the policy adds zero behavioural value while triggering
--      both `multiple_permissive_policies` and `auth_rls_initplan` WARNs.
--      Each of these tables has a companion user-scoped policy, so the
--      service-role drop is safe (the table still has at least one
--      permissive policy for non-service-role callers).
--
--   2. Add the missing FK index on `sim_swap_beta_invites.created_by`
--      (the admin who issued the invite). Without it, deleting an admin
--      user requires a full-table scan to find their issued invites.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE INDEX IF NOT EXISTS.

DROP POLICY IF EXISTS "Service role access sim_swap_credits"        ON sim_swap_credits;
DROP POLICY IF EXISTS "Service role access sim_swap_credit_ledger"  ON sim_swap_credit_ledger;
DROP POLICY IF EXISTS "Service role access sim_swap_beta_invites"   ON sim_swap_beta_invites;

CREATE INDEX IF NOT EXISTS idx_ssbi_created_by
  ON sim_swap_beta_invites (created_by);
