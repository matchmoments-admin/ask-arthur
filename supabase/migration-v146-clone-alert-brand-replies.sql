-- v146: Clone-watch — brand-reply inbound tracking schema (Phase C stub).
--
-- Creates the destination table + a SECURITY DEFINER RPC for the future
-- inbound-email handler (Cloudflare Worker → Supabase Edge Function path,
-- modelled on the existing inbound-email-config.md pattern).
--
-- Schema-only in this migration. The Cloudflare DNS / Worker / Edge
-- Function deployment is out-of-band operator work — see
-- docs/ops/inbound-email-config.md for the reference shape.
--
-- See docs/plans/clone-watch-outreach.md §15 Phase C.

CREATE TABLE IF NOT EXISTS public.clone_alert_brand_replies (
  id bigserial PRIMARY KEY,
  alert_id bigint REFERENCES public.shopfront_clone_alerts(id) ON DELETE SET NULL,
  brand text,                              -- denormalised for fast filtering
  from_email text NOT NULL,
  subject text,
  body_excerpt text,                       -- caller MUST truncate + scrub
  received_at timestamptz NOT NULL DEFAULT now(),
  classified_as text NOT NULL DEFAULT 'other'
    CHECK (classified_as IN (
      'acknowledgement',                   -- "thanks, we'll look into it"
      'takedown_confirmation',             -- "we've filed with the registrar"
      'fp_correction',                     -- "false positive — not us"
      'stop',                              -- STOP signal — suppress further sends
      'other'
    )),
  raw_message_id text UNIQUE,              -- de-dup against the inbound provider's message-id
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brand_replies_alert
  ON public.clone_alert_brand_replies (alert_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_brand_replies_brand_recent
  ON public.clone_alert_brand_replies (brand, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_brand_replies_stop_lookup
  ON public.clone_alert_brand_replies (from_email)
  WHERE classified_as = 'stop';

ALTER TABLE public.clone_alert_brand_replies ENABLE ROW LEVEL SECURITY;
-- Service-role-only — no anon / authed access.

COMMENT ON TABLE public.clone_alert_brand_replies IS
  'Inbound brand-team replies to clone-watch notifications. Populated by the inbound-email handler (Cloudflare Worker → Supabase Edge Function). Service-role only.';

-- Helper: ingest a reply. Called by the inbound-email Edge Function once
-- it has parsed the raw RFC 5322 message + classified the body.
CREATE OR REPLACE FUNCTION public.ingest_clone_alert_brand_reply(
  p_alert_id bigint,
  p_brand text,
  p_from_email text,
  p_subject text,
  p_body_excerpt text,
  p_classified_as text,
  p_raw_message_id text,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.clone_alert_brand_replies (
    alert_id, brand, from_email, subject, body_excerpt,
    classified_as, raw_message_id, meta
  )
  VALUES (
    p_alert_id, p_brand, lower(p_from_email), left(p_subject, 500),
    left(p_body_excerpt, 4000),
    COALESCE(p_classified_as, 'other'),
    p_raw_message_id,
    COALESCE(p_meta, '{}'::jsonb)
  )
  ON CONFLICT (raw_message_id) DO UPDATE
    SET subject = EXCLUDED.subject,
        body_excerpt = EXCLUDED.body_excerpt,
        classified_as = EXCLUDED.classified_as,
        meta = clone_alert_brand_replies.meta || EXCLUDED.meta
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ingest_clone_alert_brand_reply(
  bigint, text, text, text, text, text, text, jsonb
) FROM anon, authenticated;

-- Suppression check — returns true when the recipient has previously
-- replied STOP. The notify-brand Inngest function calls this before send.
CREATE OR REPLACE FUNCTION public.clone_alert_recipient_is_suppressed(
  p_email text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clone_alert_brand_replies
    WHERE classified_as = 'stop'
      AND from_email = lower(p_email)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.clone_alert_recipient_is_suppressed(text)
  FROM anon, authenticated;
