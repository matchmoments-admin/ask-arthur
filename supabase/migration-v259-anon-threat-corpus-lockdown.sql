-- v259 — revoke anon SELECT on the commercial threat corpus
--
-- FINDING (verified live in prod 2026-07-29, /ultracode enterprise review):
--   Five tables still carried `USING (true)` SELECT policies granted to the
--   {public} role — i.e. the anon key that ships in the site's own JavaScript
--   bundle. Measured with that key over plain HTTPS, no session:
--
--     scam_urls            content-range 0-0/413190
--     scam_ips             content-range 0-0/723478
--     scam_crypto_wallets  readable
--     scam_clusters        readable
--     cluster_members      readable
--
--   This is the same class v172 closed for scam_entities / scam_reports /
--   report_entity_links, on the tables v172 did not cover.
--
-- WHY IT MATTERS (beyond the raw row count):
--   1. It bypasses the paid product. The same data is sold through
--      /api/v1/threats/*, which apps/web/lib/v1-guard.ts gates on key
--      validity, per-key quota, allowed_endpoints scoping and log_api_usage
--      billing telemetry. PostgREST sits entirely outside the Next.js
--      middleware, so the scrape is unmetered, unbilled and unrated.
--   2. It is a detection-mission problem, not just a commercial one. A scam
--      operator can diff the corpus daily to learn exactly which of their
--      domains and IPs are burned, and rotate ahead of takedown.
--   3. SECURITY.md asserted the opposite ("service-role access only; no
--      public API exposure") — corrected in the same commit as this migration.
--
-- WHY THIS IS SAFE TO DROP — each checked against prod before writing:
--   a. No browser-side read exists. The only createBrowserClient call sites
--      are the login/signup forms and the fraud-manager search, and that one
--      calls the fraud_manager_search RPC (SECURITY DEFINER, EXECUTE granted
--      to service_role only) rather than touching these tables.
--   b. No SECURITY INVOKER function reads them. Verified by scanning
--      pg_proc.prosrc for all five table names across every non-DEFINER
--      function in the public schema: zero matches. (A DEFINER function runs
--      as its owner and is unaffected by RLS either way.)
--   c. Every application reader is server-side on the service_role key, which
--      bypasses RLS: /api/v1/threats/*, /api/scam-urls/lookup,
--      /api/v1/clusters/*, lib/dashboard/investigations.ts, and the Inngest
--      enrichment functions.
--   d. Writes are unaffected. These five tables have NO INSERT/UPDATE/DELETE
--      policies at all — the Python feed scrapers connect via SUPABASE_DB_URL
--      (a direct Postgres connection, RLS-exempt), and in-app writes go through
--      SECURITY DEFINER RPCs as service_role.
--
--   Net effect: anon and authenticated lose table access; service_role keeps
--   full access; no in-app code path changes behaviour.
--
-- DELIBERATELY NOT TOUCHED — these public-read policies are intentional and
-- remain in place: acnc_charities, blog_categories, check_stats, sites,
-- site_audits, pfra_members. They back public consumer surfaces (the charity
-- checker, the blog, the homepage counter) and carry no commercial or
-- attacker-useful corpus.
--
-- Idempotent (DROP … IF EXISTS). RLS is (re)asserted as ENABLED so that the
-- absence of a SELECT policy is enforced rather than implicitly open.

ALTER TABLE public.scam_urls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scam_ips            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scam_crypto_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scam_clusters       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cluster_members     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can select scam urls"    ON public.scam_urls;
DROP POLICY IF EXISTS "Public can select scam ips"     ON public.scam_ips;
DROP POLICY IF EXISTS "Public can select scam wallets" ON public.scam_crypto_wallets;
DROP POLICY IF EXISTS "Public read scam_clusters"      ON public.scam_clusters;
DROP POLICY IF EXISTS "Public read cluster_members"    ON public.cluster_members;

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (run manually if a legitimate anon consumer turns up):
--
--   CREATE POLICY "Public can select scam urls" ON public.scam_urls
--     FOR SELECT TO public USING (true);
--   CREATE POLICY "Public can select scam ips" ON public.scam_ips
--     FOR SELECT TO public USING (true);
--   CREATE POLICY "Public can select scam wallets" ON public.scam_crypto_wallets
--     FOR SELECT TO public USING (true);
--   CREATE POLICY "Public read scam_clusters" ON public.scam_clusters
--     FOR SELECT TO public USING (true);
--   CREATE POLICY "Public read cluster_members" ON public.cluster_members
--     FOR SELECT TO public USING (true);
--
-- VERIFY AFTER APPLYING (should return zero rows):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('scam_urls','scam_ips','scam_crypto_wallets',
--                        'scam_clusters','cluster_members');
-- ───────────────────────────────────────────────────────────────────────────
