-- v167 — Editable email "copy slots" for the admin Email Studio.
--
-- Each outbound React Email template (apps/web/emails/*) exposes named prose
-- "slots". The template's hardcoded prose is the DEFAULT (in
-- apps/web/lib/email/copy-registry.ts); an admin can override a slot's wording
-- from /admin/email-studio without a deploy. resolveEmailCopy() merges these
-- overrides over the code defaults at send time, so a missing row always falls
-- back to the default and a template never breaks.
--
-- Only the PROSE is editable here — layout / branding / data-driven logic stay
-- in code. Content is markdown, sanitized to an email-safe allowlist before
-- rendering. Edits never change who/when an email sends (that stays
-- flag-gated at the call site); they only change wording.

-- Active override per (template, slot).
CREATE TABLE IF NOT EXISTS public.email_copy (
  template_key TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  content_md TEXT NOT NULL,
  updated_by_admin_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_key, slot_key)
);

-- Append-only audit / rollback log.
CREATE TABLE IF NOT EXISTS public.email_copy_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  content_md TEXT NOT NULL,
  edited_by_admin_id TEXT,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_copy_history_lookup_idx
  ON public.email_copy_history (template_key, slot_key, edited_at DESC);

ALTER TABLE public.email_copy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_copy_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_copy_service_all ON public.email_copy;
CREATE POLICY email_copy_service_all ON public.email_copy
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS email_copy_history_service_all ON public.email_copy_history;
CREATE POLICY email_copy_history_service_all ON public.email_copy_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.email_copy IS
  'Admin-editable prose overrides for outbound email templates (Email Studio). Keyed (template_key, slot_key); merged over code defaults by resolveEmailCopy(). Markdown, sanitized before render. Service-role only.';
COMMENT ON TABLE public.email_copy_history IS
  'Append-only audit log of every email_copy edit, for rollback.';
