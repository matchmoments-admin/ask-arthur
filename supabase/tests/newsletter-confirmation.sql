-- Run only in a disposable DB after v303. No production data or provider calls.
BEGIN;
DO $$
DECLARE r boolean; n integer;
BEGIN
  r := public.request_newsletter_confirmation(' Reader@Example.test ', 'subscribe_page', repeat('a',64));
  ASSERT r, 'first request admitted';
  ASSERT NOT (SELECT is_active FROM public.email_subscribers WHERE email='reader@example.test'), 'request must be inactive';
  ASSERT (SELECT consent_at IS NULL FROM public.email_subscribers WHERE email='reader@example.test'), 'consent only on confirmation';
  r := public.request_newsletter_confirmation('reader@example.test', 'subscribe_page', repeat('b',64));
  ASSERT NOT r, 'cooldown prevents repeat email';
  ASSERT public.confirm_newsletter_subscription(repeat('a',64)), 'valid token confirms';
  ASSERT NOT public.confirm_newsletter_subscription(repeat('a',64)), 'token single use';
  ASSERT (SELECT is_active AND consent_at IS NOT NULL FROM public.email_subscribers WHERE email='reader@example.test'), 'confirmed active';
  ASSERT NOT public.request_newsletter_confirmation('reader@example.test', 'subscribe_page', repeat('b',64)), 'already active no mail';

  UPDATE public.email_subscribers SET is_active=false, confirmation_requested_at=now()-interval '16 minutes' WHERE email='reader@example.test';
  ASSERT public.request_newsletter_confirmation('reader@example.test', 'subscribe_page', repeat('b',64)), 'resubscribe requests ownership';
  ASSERT NOT (SELECT is_active FROM public.email_subscribers WHERE email='reader@example.test'), 'resubscribe stays inactive';
  UPDATE public.email_subscribers SET is_active=false WHERE email='reader@example.test';
  ASSERT NOT public.confirm_newsletter_subscription(repeat('b',64)), 'optout clears pending token even if inactive';
  PERFORM public.unsubscribe_newsletter('READER@EXAMPLE.TEST');
  ASSERT NOT (SELECT is_active FROM public.email_subscribers WHERE email='reader@example.test'), 'case-insensitive optout';
  ASSERT NOT public.confirm_newsletter_subscription(NULL), 'null token rejected';
  ASSERT NOT public.confirm_newsletter_subscription('bad'), 'malformed token rejected';

  ASSERT public.request_newsletter_confirmation('expire@example.test', 'subscribe_page', repeat('c',64)), 'new expiry request';
  UPDATE public.email_subscribers SET confirmation_expires_at=now()-interval '1 second' WHERE email='expire@example.test';
  ASSERT NOT public.confirm_newsletter_subscription(repeat('c',64)), 'expired token rejected';

  INSERT INTO public.brand_report_unsubscribes (email,source) VALUES ('blocked@example.test','resend_complaint');
  ASSERT NOT public.request_newsletter_confirmation('blocked@example.test','subscribe_page',repeat('d',64)), 'complaint suppresses request';
  ASSERT public.request_newsletter_confirmation('bounce@example.test','subscribe_page',repeat('d',64)), 'pending before bounce';
  INSERT INTO public.brand_report_unsubscribes (email,source) VALUES ('bounce@example.test','resend_bounce');
  ASSERT NOT public.confirm_newsletter_subscription(repeat('d',64)), 'bounce before confirm blocks activation';

  INSERT INTO public.feature_brakes(feature,paused_until) VALUES('newsletter_confirmation',now()+interval '1 hour');
  BEGIN
    PERFORM public.request_newsletter_confirmation('braked@example.test','subscribe_page',repeat('e',64));
    RAISE EXCEPTION 'brake did not reject' USING ERRCODE='check_violation';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM='newsletter confirmation paused', 'brake error';
  END;
  DELETE FROM public.feature_brakes WHERE feature='newsletter_confirmation';
  UPDATE public.newsletter_confirmation_budget SET attempts=200;
  BEGIN
    PERFORM public.request_newsletter_confirmation('budget@example.test','subscribe_page',repeat('e',64));
    RAISE EXCEPTION 'budget did not reject' USING ERRCODE='check_violation';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM='newsletter confirmation daily limit', 'budget error';
  END;
  ASSERT NOT EXISTS(SELECT 1 FROM public.email_subscribers WHERE email='budget@example.test'), 'limit leaves no pending subscriber';

  UPDATE public.email_subscribers SET confirmation_requested_at=now()-interval '8 days' WHERE email IN ('reader@example.test','expire@example.test');
  n := public.prune_newsletter_confirmation_requests();
  ASSERT n=1, 'prunes only never-confirmed request';
  ASSERT EXISTS(SELECT 1 FROM public.email_subscribers WHERE email='reader@example.test'), 'preserves prior consent';
  ASSERT NOT has_function_privilege('anon','public.confirm_newsletter_subscription(text)','EXECUTE'), 'anon cannot activate';
  ASSERT NOT has_function_privilege('authenticated','public.request_newsletter_confirmation(text,text,text)','EXECUTE'), 'user cannot bypass request gate';
  ASSERT has_function_privilege('service_role','public.confirm_newsletter_subscription(text)','EXECUTE'), 'service caller can confirm';
END;
$$;
ROLLBACK;
