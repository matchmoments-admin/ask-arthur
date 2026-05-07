-- Migration v109: deny-all RESTRICTIVE policies on 3 tables left
-- without any policy after v106
--
-- v106 dropped the USING(true) "Service role can ..." policies on
-- email_subscribers, feed_ingestion_log, and verified_scams. These
-- tables had only those single permissive policies, so dropping them
-- left the tables in rls_enabled_no_policy state — which is
-- functionally identical (deny-by-default for non-service_role) but
-- generates an INFO advisor.
--
-- v101 already established the pattern of adding explicit RESTRICTIVE
-- deny-all policies to formalise intent. Applying the same pattern
-- here closes the 3 INFO findings.
--
-- service_role bypasses RLS regardless, so backend writers continue
-- to work normally.

DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.email_subscribers;
CREATE POLICY deny_all_anon_authenticated ON public.email_subscribers
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.feed_ingestion_log;
CREATE POLICY deny_all_anon_authenticated ON public.feed_ingestion_log
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all_anon_authenticated ON public.verified_scams;
CREATE POLICY deny_all_anon_authenticated ON public.verified_scams
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
