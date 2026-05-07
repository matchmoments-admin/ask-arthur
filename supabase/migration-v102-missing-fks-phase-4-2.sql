-- Migration v102: add genuinely-missing FKs surfaced by the schema audit
--
-- Phase 4.2 of the data-model improvement plan listed 7 candidate FKs.
-- Pre-flight against the live schema (information_schema.columns + pg_constraint)
-- found that 5 of the 7 either already exist or reference columns that don't
-- exist. Only 2 FKs actually need adding:
--
--   1. cost_telemetry.user_id → auth.users(id) ON DELETE SET NULL
--      Column exists, nullable, 0 orphan rows out of 73 (verified pre-flight).
--      Without this, deleted users leave orphaned cost-attribution rows;
--      analytics that join through users get NULL gaps; audit trail is
--      unenforceable. SET NULL preserves cost data after user deletion.
--
--   2. extension_subscriptions.install_id → extension_installs(install_id)
--      ON DELETE CASCADE.
--      Column exists, NOT NULL, 0 rows in either table. Subscription
--      records are tied to a specific install fingerprint; revoking the
--      install should drop the subscription record (it can't be reactivated
--      against a different install). The FK target column is `install_id`
--      (the PK of extension_installs), not `id` — the original audit
--      misread the column name.
--
-- Audit findings that were INCORRECT (skipped, not in this migration):
--
--   - family_activity_log.member_id — already FK to family_members(id)
--     ON DELETE SET NULL. Audit pattern-matched on a missing constraint
--     name; the actual constraint exists with a non-conventional name.
--
--   - breach_sources_raw.breach_id — already FK to breaches(id)
--     ON DELETE SET NULL. Same pattern-match miss.
--
--   - org_members.invited_by — already FK to auth.users(id) (no
--     ON DELETE clause; defaults to NO ACTION). Could be enhanced to
--     SET NULL to handle deleted inviter, but this is a separate
--     concern; the FK exists and the advisor doesn't flag it.
--
--   - leads.created_by — column does not exist on leads table.
--     Schema audit confused this with a different table or hallucinated
--     the column. leads has no created_by column today.
--
--   - organizations.created_by — column does not exist on organizations
--     table. Same as leads. organizations has created_at but no
--     created_by audit column.
--
-- Idempotent via ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS guard
-- (Postgres 16+) — fall back to a DO block for older versions.
-- Pre-flight verified zero orphans, so adding as immediate-VALID
-- (no NOT VALID + VALIDATE dance needed).

-- ─── 1. cost_telemetry.user_id → auth.users(id) ON DELETE SET NULL ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
    WHERE c.conrelid = 'public.cost_telemetry'::regclass
      AND c.contype = 'f'
      AND a.attname = 'user_id'
  ) THEN
    ALTER TABLE public.cost_telemetry
      ADD CONSTRAINT cost_telemetry_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 2. extension_subscriptions.install_id → extension_installs(install_id) ─
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
    WHERE c.conrelid = 'public.extension_subscriptions'::regclass
      AND c.contype = 'f'
      AND a.attname = 'install_id'
  ) THEN
    ALTER TABLE public.extension_subscriptions
      ADD CONSTRAINT extension_subscriptions_install_id_fkey
      FOREIGN KEY (install_id) REFERENCES public.extension_installs(install_id) ON DELETE CASCADE;
  END IF;
END $$;

-- ─── Verification (run manually after apply) ────────────────────────────────
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname IN ('cost_telemetry_user_id_fkey', 'extension_subscriptions_install_id_fkey');
--   → should return both with the expected ON DELETE behavior.
