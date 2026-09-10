BEGIN;
DO $$
DECLARE v_id uuid; v_sub bigint; v_claim record;
BEGIN
 INSERT INTO public.email_subscribers(email,is_active) VALUES ('newsletter-test@example.invalid',true) RETURNING id INTO v_sub;
 INSERT INTO public.newsletter_issues(window_start,window_end,content)
 VALUES ('2099-01-01','2099-01-08','{}') RETURNING id INTO v_id;
 BEGIN
   PERFORM public.start_newsletter_issue(v_id,1);
   RAISE EXCEPTION 'TEST: draft was sendable';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'issue_not_approved' THEN RAISE; END IF;
 END;
 UPDATE public.newsletter_issues SET status='approved',approved_revision=1,rendered_html='frozen',rendered_text='frozen',sender='test@example.invalid' WHERE id=v_id;
 BEGIN
   PERFORM public.start_newsletter_issue(v_id,2);
   RAISE EXCEPTION 'TEST: stale revision was sendable';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'issue_not_approved' THEN RAISE; END IF;
 END;
 IF public.claim_newsletter_test(v_id,1) IS NOT TRUE THEN RAISE EXCEPTION 'TEST: first test claim refused'; END IF;
 IF public.claim_newsletter_test(v_id,1) IS NOT FALSE THEN RAISE EXCEPTION 'TEST: repeated test claim allowed'; END IF;
 BEGIN
   PERFORM public.start_newsletter_issue(v_id,1);
   RAISE EXCEPTION 'TEST: unaccepted inbox test allowed audience send';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'inbox_test_required' THEN RAISE; END IF;
 END;
 UPDATE public.newsletter_test_sends SET provider_id='synthetic-receipt' WHERE issue_id=v_id;
 PERFORM public.start_newsletter_issue(v_id,1);
 PERFORM public.start_newsletter_issue(v_id,1);
 IF (SELECT count(*) FROM public.newsletter_deliveries WHERE issue_id=v_id AND subscriber_id=v_sub) <> 1 THEN RAISE EXCEPTION 'TEST: recipient duplicated'; END IF;
 -- Ensure the deterministic claim below targets only the synthetic row.
 DELETE FROM public.newsletter_deliveries WHERE issue_id=v_id AND subscriber_id<>v_sub;
 SELECT * INTO v_claim FROM public.claim_newsletter_delivery(v_id);
 IF v_claim.subscriber_id <> v_sub OR v_claim.email <> 'newsletter-test@example.invalid' THEN RAISE EXCEPTION 'TEST: wrong claim'; END IF;
 IF EXISTS (SELECT 1 FROM public.claim_newsletter_delivery(v_id)) THEN RAISE EXCEPTION 'TEST: ambiguous attempt reclaimed'; END IF;
 UPDATE public.newsletter_deliveries SET status='pending' WHERE issue_id=v_id;
 UPDATE public.email_subscribers SET is_active=false WHERE id=v_sub;
 SELECT * INTO v_claim FROM public.claim_newsletter_delivery(v_id);
 IF v_claim.email IS NOT NULL THEN RAISE EXCEPTION 'TEST: unsubscribed recipient claimed'; END IF;
 IF (SELECT status FROM public.newsletter_deliveries WHERE issue_id=v_id AND subscriber_id=v_sub)<>'suppressed' THEN RAISE EXCEPTION 'TEST: suppression not recorded'; END IF;
 UPDATE public.email_subscribers SET is_active=true WHERE id=v_sub;
 UPDATE public.newsletter_deliveries SET status='pending' WHERE issue_id=v_id;
 INSERT INTO public.brand_report_unsubscribes(email) VALUES ('newsletter-test@example.invalid');
 SELECT * INTO v_claim FROM public.claim_newsletter_delivery(v_id);
 IF v_claim.email IS NOT NULL THEN RAISE EXCEPTION 'TEST: durable suppression ignored'; END IF;
 INSERT INTO public.feature_brakes(feature,paused_until) VALUES ('newsletter_send',now()+interval '1 hour') ON CONFLICT(feature) DO UPDATE SET paused_until=excluded.paused_until;
 BEGIN
   PERFORM public.claim_newsletter_delivery(v_id);
   RAISE EXCEPTION 'TEST: brake ignored';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'newsletter_send_paused' THEN RAISE; END IF;
 END;
 IF has_table_privilege('anon','public.newsletter_issues','SELECT') OR has_table_privilege('authenticated','public.newsletter_deliveries','SELECT') THEN RAISE EXCEPTION 'TEST: private records exposed'; END IF;
 IF has_function_privilege('anon','public.start_newsletter_issue(uuid,integer)','EXECUTE') THEN RAISE EXCEPTION 'TEST: public send RPC'; END IF;
END;
$$;
ROLLBACK;
