-- v303: prove address ownership before new/reactivated newsletter subscriptions.
-- Existing active subscribers keep their status. New requests are inactive;
-- confirmation is single-use and atomically activates the matching row.
-- Rollback: leave additive fields/functions in place; pause signup rather than
-- restoring the old unconfirmed activation route. No existing rows are rewritten.
SET statement_timeout = '30s';

ALTER TABLE public.email_subscribers
  ADD COLUMN IF NOT EXISTS confirmation_token_hash text,
  ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_requested_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS email_subscribers_confirmation_token_idx
  ON public.email_subscribers (confirmation_token_hash)
  WHERE confirmation_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.newsletter_confirmation_budget (
  day date PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts BETWEEN 0 AND 200)
);
ALTER TABLE public.newsletter_confirmation_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_confirmation_budget FROM anon, authenticated;
DROP POLICY IF EXISTS newsletter_budget_service ON public.newsletter_confirmation_budget;
CREATE POLICY newsletter_budget_service ON public.newsletter_confirmation_budget
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.newsletter_confirmation_budget TO service_role;

-- All existing unsubscribe/bounce writers update is_active. Invalidate pending
-- links even when the row was already inactive; old links cannot undo an opt-out.
CREATE OR REPLACE FUNCTION public.clear_newsletter_confirmation_on_optout()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.is_active = false THEN
    NEW.confirmation_token_hash := NULL;
    NEW.confirmation_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS newsletter_optout_clears_confirmation ON public.email_subscribers;
CREATE TRIGGER newsletter_optout_clears_confirmation
  BEFORE UPDATE OF is_active ON public.email_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.clear_newsletter_confirmation_on_optout();

CREATE OR REPLACE FUNCTION public.request_newsletter_confirmation(
  p_email text, p_source text, p_token_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET statement_timeout = '5s' AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_row public.email_subscribers%ROWTYPE;
  v_attempts integer;
BEGIN
  IF v_email IS NULL OR length(v_email) > 254 OR position('@' in v_email) < 2
     OR p_source IS NULL OR length(p_source) NOT BETWEEN 1 AND 100
     OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid newsletter request';
  END IF;
  -- An operator-controlled brake plus a hard global 200-attempt/day ceiling.
  -- Any DB error fails the route closed; attempts include failed provider sends.
  IF EXISTS (SELECT 1 FROM public.feature_brakes
      WHERE feature = 'newsletter_confirmation' AND paused_until > now()) THEN
    RAISE EXCEPTION 'newsletter confirmation paused';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_report_unsubscribes
      WHERE lower(btrim(email)) = v_email
        AND source IN ('resend_bounce', 'resend_complaint')) THEN
    RETURN false;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 303));
  SELECT * INTO v_row FROM public.email_subscribers
    WHERE lower(btrim(email)) = v_email ORDER BY id LIMIT 1 FOR UPDATE;
  IF v_row.is_active OR v_row.confirmation_requested_at > now() - interval '15 minutes' THEN
    RETURN false;
  END IF;
  INSERT INTO public.newsletter_confirmation_budget (day, attempts)
    VALUES ((now() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (day) DO UPDATE SET attempts = newsletter_confirmation_budget.attempts + 1
      WHERE newsletter_confirmation_budget.attempts < 200
    RETURNING attempts INTO v_attempts;
  IF v_attempts IS NULL THEN RAISE EXCEPTION 'newsletter confirmation daily limit'; END IF;
  IF v_row.id IS NULL THEN
    INSERT INTO public.email_subscribers
      (email, is_active, consent_source, confirmation_token_hash,
       confirmation_expires_at, confirmation_requested_at)
    VALUES (v_email, false, p_source, p_token_hash, now() + interval '24 hours', now());
  ELSE
    -- Do not set is_active here: the opt-out trigger deliberately cancels tokens.
    UPDATE public.email_subscribers SET
      confirmation_token_hash = p_token_hash,
      confirmation_expires_at = now() + interval '24 hours',
      confirmation_requested_at = now(), consent_source = p_source
      WHERE id = v_row.id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_newsletter_subscription(p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET statement_timeout = '5s' AS $$
DECLARE v_row public.email_subscribers%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT * INTO v_row FROM public.email_subscribers
    WHERE confirmation_token_hash = p_token_hash FOR UPDATE;
  IF v_row.id IS NULL OR v_row.confirmation_expires_at IS NULL OR v_row.confirmation_expires_at <= now() THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.brand_report_unsubscribes
      WHERE lower(btrim(email)) = lower(btrim(v_row.email))
        AND source IN ('resend_bounce', 'resend_complaint')) THEN RETURN false; END IF;
  UPDATE public.email_subscribers SET is_active = true, consent_at = now(),
    updated_at = now(), confirmation_token_hash = NULL, confirmation_expires_at = NULL
    WHERE id = v_row.id;
  RETURN true;
END;
$$;

-- Bounded cleanup, called by the weekly email cron. Retain confirmed/legacy
-- subscribers; only never-confirmed expired requests are deleted after 7 days.
CREATE OR REPLACE FUNCTION public.prune_newsletter_confirmation_requests()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET statement_timeout = '5s' AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.email_subscribers WHERE id IN (
    SELECT id FROM public.email_subscribers WHERE is_active = false
      AND consent_at IS NULL AND confirmation_requested_at < now() - interval '7 days'
      ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM public.newsletter_confirmation_budget
    WHERE day IN (SELECT day FROM public.newsletter_confirmation_budget
      WHERE day < current_date - 30 ORDER BY day LIMIT 100);
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.request_newsletter_confirmation(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_newsletter_subscription(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_newsletter_confirmation_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_newsletter_confirmation(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_newsletter_subscription(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_newsletter_confirmation_requests() TO service_role;

-- Canonical matching also covers legacy mixed-case addresses. Trigger above
-- clears pending links in the same transaction as the opt-out.
CREATE OR REPLACE FUNCTION public.unsubscribe_newsletter(p_email text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ''
SET statement_timeout = '5s' AS $$
  UPDATE public.email_subscribers SET is_active = false, updated_at = now()
    WHERE lower(btrim(email)) = lower(btrim(p_email));
$$;
REVOKE ALL ON FUNCTION public.unsubscribe_newsletter(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unsubscribe_newsletter(text) TO service_role;
