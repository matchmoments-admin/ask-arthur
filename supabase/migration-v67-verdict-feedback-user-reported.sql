-- migration-v67: Widen verdict_feedback.user_says CHECK constraint to accept
-- the "user_reported" signal emitted by the simplified hero result card's
-- "Report this scam" button (fires to /api/feedback alongside opening the
-- Scamwatch portal in a new tab).
--
-- Additive only — existing rows are unaffected, existing three values remain
-- valid. Safe to apply before or after the client deploy.

BEGIN;

-- Drop any existing user_says check constraint. Inline column CHECKs in v47
-- get an auto-generated name (PostgreSQL default is {table}_{col}_check) —
-- look it up by definition so we're robust to either naming.
DO $$
DECLARE
  conname_to_drop text;
BEGIN
  SELECT conname INTO conname_to_drop
  FROM pg_constraint
  WHERE conrelid = 'public.verdict_feedback'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%user_says%';

  IF conname_to_drop IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.verdict_feedback DROP CONSTRAINT %I', conname_to_drop);
  END IF;
END$$;

ALTER TABLE public.verdict_feedback
  ADD CONSTRAINT verdict_feedback_user_says_check
  CHECK (user_says IN ('correct', 'false_positive', 'false_negative', 'user_reported'));

COMMIT;
