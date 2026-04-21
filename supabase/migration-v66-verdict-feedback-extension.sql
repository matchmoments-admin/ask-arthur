-- migration-v66: Extend verdict_feedback with reason codes, training consent,
-- optional report linkage, and UA / locale telemetry. Additive only — safe to
-- apply ahead of the Result Screen V2 UI rollout.

BEGIN;

ALTER TABLE public.verdict_feedback
  ADD COLUMN IF NOT EXISTS scam_report_id BIGINT
    REFERENCES public.scam_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS analysis_id TEXT,
  ADD COLUMN IF NOT EXISTS reason_codes TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS training_consent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS wants_followup BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_email TEXT,
  ADD COLUMN IF NOT EXISTS user_agent_family TEXT,
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en-AU';

-- followup_email is reserved for P1 (requires an unsubscribe surface + app-layer
-- encryption helper). Enforce the pairing at the DB layer so we can't silently
-- store an email without the consent flag later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verdict_feedback_followup_email_ck'
  ) THEN
    ALTER TABLE public.verdict_feedback
      ADD CONSTRAINT verdict_feedback_followup_email_ck
      CHECK (wants_followup = false OR (followup_email IS NOT NULL AND length(followup_email) > 3));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_verdict_feedback_scam_report
  ON public.verdict_feedback (scam_report_id);

-- App-layer reason-code vocabulary (stored as free TEXT[] for forward-compat):
--   not_a_scam | missed_something | too_confusing | wrong_details | other
COMMENT ON COLUMN public.verdict_feedback.reason_codes IS
  'App-layer enum (not DB-enforced): not_a_scam | missed_something | too_confusing | wrong_details | other';
COMMENT ON COLUMN public.verdict_feedback.training_consent IS
  'User opt-in for de-identified training use. Defaults off. No downstream pipeline reads this until PIA lands (P2).';
COMMENT ON COLUMN public.verdict_feedback.followup_email IS
  'Reserved for P1 — requires app-layer encryption helper before use.';

COMMIT;
