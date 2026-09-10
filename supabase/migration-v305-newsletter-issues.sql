-- Durable editorial approval and per-recipient delivery state. Additive rollback:
-- disable NEWSLETTER_SEND_ENABLED; preserve issues/receipts for reconciliation.
SET statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS public.newsletter_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start timestamptz NOT NULL UNIQUE,
  window_end timestamptz NOT NULL,
  content jsonb NOT NULL,
  candidates jsonb NOT NULL DEFAULT '[]',
  source_health jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  approved_revision integer,
  rendered_html text,
  rendered_text text,
  sender text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sending','sent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end > window_start),
  CHECK (status = 'draft' OR (approved_revision IS NOT NULL AND approved_revision = revision))
);
CREATE TABLE IF NOT EXISTS public.newsletter_deliveries (
  issue_id uuid NOT NULL REFERENCES public.newsletter_issues(id),
  subscriber_id bigint NOT NULL REFERENCES public.email_subscribers(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','suppressed')),
  provider_id text,
  attempted_at timestamptz,
  PRIMARY KEY (issue_id, subscriber_id)
);
ALTER TABLE public.newsletter_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_issues, public.newsletter_deliveries FROM anon, authenticated;
DROP POLICY IF EXISTS newsletter_issues_service ON public.newsletter_issues;
CREATE POLICY newsletter_issues_service ON public.newsletter_issues FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS newsletter_deliveries_service ON public.newsletter_deliveries;
CREATE POLICY newsletter_deliveries_service ON public.newsletter_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.newsletter_issues, public.newsletter_deliveries TO service_role;

-- A controlled operator-only inbox test of the same frozen revision is required
-- before audience delivery. No recipient addresses are copied into this table.
CREATE TABLE IF NOT EXISTS public.newsletter_test_sends (
 issue_id uuid NOT NULL REFERENCES public.newsletter_issues(id),
 revision integer NOT NULL,
 attempted_at timestamptz NOT NULL DEFAULT now(),
 provider_id text,
 PRIMARY KEY(issue_id, revision)
);
CREATE INDEX IF NOT EXISTS newsletter_test_sends_attempted_idx ON public.newsletter_test_sends(attempted_at);
ALTER TABLE public.newsletter_test_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_test_sends FROM anon, authenticated;
DROP POLICY IF EXISTS newsletter_test_sends_service ON public.newsletter_test_sends;
CREATE POLICY newsletter_test_sends_service ON public.newsletter_test_sends FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.newsletter_test_sends TO service_role;

-- Row lock serialises initialisation with editor saves and approval changes.
CREATE OR REPLACE FUNCTION public.start_newsletter_issue(p_id uuid, p_revision integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10s' AS $$
DECLARE v public.newsletter_issues%ROWTYPE;
BEGIN
 SELECT * INTO v FROM public.newsletter_issues WHERE id = p_id FOR UPDATE;
 IF NOT FOUND OR v.revision <> p_revision OR v.approved_revision IS DISTINCT FROM p_revision OR v.status NOT IN ('approved','sending') OR v.rendered_html IS NULL OR v.rendered_text IS NULL OR v.sender IS NULL THEN
   RAISE EXCEPTION 'issue_not_approved';
 END IF;
 IF EXISTS (SELECT 1 FROM public.feature_brakes WHERE feature = 'newsletter_send' AND paused_until > now()) THEN
   RAISE EXCEPTION 'newsletter_send_paused';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.newsletter_test_sends WHERE issue_id=p_id AND revision=p_revision AND provider_id IS NOT NULL) THEN RAISE EXCEPTION 'inbox_test_required'; END IF;
 IF v.status = 'approved' THEN
   INSERT INTO public.newsletter_deliveries(issue_id, subscriber_id)
   SELECT p_id, s.id FROM public.email_subscribers s
   WHERE s.is_active = true AND NOT EXISTS (
     SELECT 1 FROM public.brand_report_unsubscribes b WHERE lower(b.email) = lower(s.email)
   );
   UPDATE public.newsletter_issues SET status = 'sending', updated_at = now() WHERE id = p_id;
 END IF;
END;
$$;

-- No automatic reclamation of an ambiguous provider attempt: unknown sends
-- require provider reconciliation, even after its idempotency window expires.
CREATE OR REPLACE FUNCTION public.claim_newsletter_delivery(p_id uuid)
RETURNS TABLE (subscriber_id bigint, email text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '5s' AS $$
#variable_conflict use_column
DECLARE v_id bigint; v_email text; v_active boolean;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.newsletter_issues WHERE id=p_id AND status='sending' AND revision=approved_revision) THEN RETURN; END IF;
 IF EXISTS (SELECT 1 FROM public.feature_brakes WHERE feature='newsletter_send' AND paused_until>now()) THEN RAISE EXCEPTION 'newsletter_send_paused'; END IF;
 SELECT d.subscriber_id INTO v_id FROM public.newsletter_deliveries d
 WHERE d.issue_id=p_id AND d.status='pending' ORDER BY d.subscriber_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT s.email,s.is_active INTO v_email,v_active FROM public.email_subscribers s WHERE s.id=v_id;
 IF v_active IS NOT TRUE OR EXISTS (SELECT 1 FROM public.brand_report_unsubscribes b WHERE lower(b.email)=lower(v_email)) THEN
   UPDATE public.newsletter_deliveries SET status='suppressed' WHERE issue_id=p_id AND subscriber_id=v_id;
   RETURN QUERY SELECT v_id, NULL::text;
 ELSE
   UPDATE public.newsletter_deliveries SET status='sending',attempted_at=now() WHERE issue_id=p_id AND subscriber_id=v_id;
   RETURN QUERY SELECT v_id,v_email;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.start_newsletter_issue(uuid,integer), public.claim_newsletter_delivery(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_newsletter_issue(uuid,integer), public.claim_newsletter_delivery(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_newsletter_test(p_id uuid, p_revision integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '5s' AS $$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(305,1);
 IF NOT EXISTS (SELECT 1 FROM public.newsletter_issues WHERE id=p_id AND revision=p_revision AND approved_revision=p_revision AND status='approved') THEN RAISE EXCEPTION 'issue_not_approved'; END IF;
 IF EXISTS (SELECT 1 FROM public.feature_brakes WHERE feature='newsletter_send' AND paused_until>now()) THEN RAISE EXCEPTION 'newsletter_send_paused'; END IF;
 IF EXISTS (SELECT 1 FROM public.newsletter_test_sends WHERE issue_id=p_id AND revision=p_revision) THEN RETURN false; END IF;
 IF (SELECT count(*) FROM public.newsletter_test_sends WHERE attempted_at>now()-interval '24 hours') >= 20 THEN RAISE EXCEPTION 'newsletter_test_budget_exceeded'; END IF;
 INSERT INTO public.newsletter_test_sends(issue_id,revision) VALUES(p_id,p_revision);
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_newsletter_test(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_newsletter_test(uuid,integer) TO service_role;
