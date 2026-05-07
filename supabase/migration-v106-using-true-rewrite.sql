-- Migration v106: drop 13 USING(true) write policies that double as a
-- security hole (Phase 1.4)
--
-- The Supabase advisor flagged 16 policies as `rls_policy_always_true`
-- across 7 tables. Per-policy review revealed two distinct populations:
--
-- 1. THIRTEEN service-role-named write policies that have USING(true)
--    (or WITH CHECK (true)) and `TO public` — meaning anon and
--    authenticated callers can also INSERT / UPDATE / DELETE rows in
--    these tables, even though the policy NAME claims service-role
--    intent. Examples:
--      "Service role can insert scam ips" ON scam_ips
--        TO public WITH CHECK (true)  ← anon can write to scam_ips today
--    These policies are redundant and dangerous: service_role bypasses
--    RLS entirely, so the policies are only ever consulted for non-
--    service_role callers, where they should DENY (not allow). Dropping
--    them closes a privilege-escalation surface and clears 12 advisor
--    WARNs (one of the 13 is on email_subscribers ALL — counts as 1).
--
-- 2. FOUR public-read policies that legitimately want USING(true):
--      "Public can read stats" ON check_stats SELECT
--      "Public can select scam wallets" ON scam_crypto_wallets SELECT
--      "Public can select scam ips" ON scam_ips SELECT
--      "Public can select scam urls" ON scam_urls SELECT
--    These are intentional: the IOC tables and the public stats
--    counters are designed for public threat-intelligence display.
--    A natural row-filter (e.g. is_active = true) would be technically
--    correct but would also break the public IOC feed if a row were
--    flagged inactive while still being legitimately viewable. We KEEP
--    these as USING(true) and accept the residual 4 advisor WARNs as
--    documented intent.
--
-- Verification of writer paths before drop:
--   - scam_urls / scam_ips / scam_crypto_wallets: Python scrapers
--     (direct DB connection, RLS-bypassing) + ct-monitor.ts /
--     report-email/route.ts (service_role).
--   - check_stats: /api/analyze writes via service_role.
--   - email_subscribers: /api/subscribe, /api/waitlist, /api/unsubscribe
--     all use createServiceClient() — verified pre-flight.
--   - feed_ingestion_log: Python scrapers (direct DB).
--   - verified_scams: Inngest cluster-builder + Phase 2 admin API,
--     both service_role.
--
-- All 13 dropped policies have at least one verified service_role
-- writer, so dropping them changes NO real-world behaviour for backend
-- code. The only "behaviour change" is closing the anon/authenticated
-- write hole — which is the security improvement we want.
--
-- Idempotent via DROP POLICY IF EXISTS.

-- ─── check_stats: drop 2 service-role-named write policies ──────────────────
DROP POLICY IF EXISTS "Service role can insert stats" ON public.check_stats;
DROP POLICY IF EXISTS "Service role can update stats" ON public.check_stats;

-- ─── email_subscribers: drop the only USING(true) policy ────────────────────
-- After drop: only service_role can read/write (via RLS bypass). anon and
-- authenticated lose any access — which is correct (subscriber list is
-- not user-facing).
DROP POLICY IF EXISTS "Service role can manage subscribers" ON public.email_subscribers;

-- ─── feed_ingestion_log: drop 2 service-role-named policies ─────────────────
DROP POLICY IF EXISTS "Service role can insert feed log" ON public.feed_ingestion_log;
DROP POLICY IF EXISTS "Service role can select feed log" ON public.feed_ingestion_log;

-- ─── scam_crypto_wallets: drop 3 service-role-named write policies ──────────
DROP POLICY IF EXISTS "Service role can delete scam wallets" ON public.scam_crypto_wallets;
DROP POLICY IF EXISTS "Service role can insert scam wallets" ON public.scam_crypto_wallets;
DROP POLICY IF EXISTS "Service role can update scam wallets" ON public.scam_crypto_wallets;

-- ─── scam_ips: drop 3 service-role-named write policies ─────────────────────
DROP POLICY IF EXISTS "Service role can delete scam ips" ON public.scam_ips;
DROP POLICY IF EXISTS "Service role can insert scam ips" ON public.scam_ips;
DROP POLICY IF EXISTS "Service role can update scam ips" ON public.scam_ips;

-- ─── scam_urls: drop 3 service-role-named write policies ────────────────────
DROP POLICY IF EXISTS "Service role can delete scam urls" ON public.scam_urls;
DROP POLICY IF EXISTS "Service role can insert scam urls" ON public.scam_urls;
DROP POLICY IF EXISTS "Service role can update scam urls" ON public.scam_urls;

-- ─── verified_scams: drop 4 policies (no public-read intent) ────────────────
-- After drop: only service_role can read/write. verified_scams is admin-
-- curated data displayed via service-role-fetched API routes, not via
-- direct PostgREST anon reads.
DROP POLICY IF EXISTS "Service role can delete scams" ON public.verified_scams;
DROP POLICY IF EXISTS "Service role can insert scams" ON public.verified_scams;
DROP POLICY IF EXISTS "Service role can update scams" ON public.verified_scams;
DROP POLICY IF EXISTS "Service role can select scams" ON public.verified_scams;

-- ─── Verification (run manually after apply) ────────────────────────────────
-- SELECT tablename, count(*) AS using_true_remaining
-- FROM pg_policies
-- WHERE schemaname='public'
--   AND tablename IN ('check_stats','email_subscribers','feed_ingestion_log',
--                     'scam_crypto_wallets','scam_ips','scam_urls','verified_scams')
--   AND (qual='true' OR with_check='true')
-- GROUP BY tablename;
--   → check_stats: 1 ('Public can read stats')
--   → scam_crypto_wallets: 1 ('Public can select scam wallets')
--   → scam_ips: 1 ('Public can select scam ips')
--   → scam_urls: 1 ('Public can select scam urls')
--   → email_subscribers / feed_ingestion_log / verified_scams: 0
--   Total: 4 (down from 16; 12 closed)
--
-- mcp__supabase__get_advisors security:
--   rls_policy_always_true: 16 → 4 (the 4 documented public-read policies)
