-- migration-v194-clone-watch-disputes.sql
-- Governance ledger for Clone Watch brand/registrar disputes.
--
-- WHY: publishing brand-lookalike + registrar data invites disputes ("that's
-- our legitimate domain / licensed reseller"). The methodology page promises a
-- stated correction process; this table is the internal ledger backing it —
-- what was disputed, the evidence shared, and the resolution. A prerequisite
-- for going public defensibly (#371 / §i of the content spec).
--
-- Deny-all RLS; service_role bypass. Admin-only via /api/admin/clone-watch/
-- dispute. Not a hot table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.clone_watch_disputes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text        NOT NULL CHECK (subject_type IN ('brand', 'registrar')),
  subject      text        NOT NULL,
  disputant    text,
  claim        text        NOT NULL,
  evidence     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resolution   text        NOT NULL DEFAULT 'pending'
                 CHECK (resolution IN ('pending', 'corrected', 'upheld', 'withdrawn')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_clone_watch_disputes_open
  ON public.clone_watch_disputes (created_at DESC)
  WHERE resolution = 'pending';

ALTER TABLE public.clone_watch_disputes ENABLE ROW LEVEL SECURITY;
-- Deny-all default; service_role bypasses RLS. Admin API uses the service role.
REVOKE ALL ON public.clone_watch_disputes FROM anon, authenticated;

COMMIT;
