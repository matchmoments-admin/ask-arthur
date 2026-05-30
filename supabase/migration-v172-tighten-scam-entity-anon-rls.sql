-- v172 — tighten anon RLS on the scam-entity tables (#558c)
--
-- FINDING (verified live in prod 2026-05-30):
--   scam_entities, scam_reports and report_entity_links each carried a single
--   RLS policy: `Public read … USING (true)` granted to the {public} role —
--   i.e. the anon key that ships in the client bundle. An unauthenticated
--   GET /rest/v1/scam_entities?select=* returned all rows (93 at audit time),
--   including raw scammer phone numbers and email addresses in
--   normalized_value, fully paginatable — a bulk-export of the flagged-contact
--   dataset to anyone holding the public anon key.
--
-- WHY THIS IS SAFE TO DROP:
--   No application code path reads these tables via the anon/browser client.
--   Every reader (B2B /api/v1/entities/*, /api/scam-contacts/lookup, the
--   dashboard libs, the fraud-manager page, all Inngest enrichment fns) uses
--   createServiceClient → the service_role key, which BYPASSES RLS entirely.
--   The public reputation lookup is the rate-limited, single-entity
--   /api/scam-contacts/lookup route (service_role server-side), not direct
--   table access. Dropping the anon SELECT therefore closes the bulk-export
--   hole with zero in-app impact.
--
--   Writes are unaffected: there are no INSERT/UPDATE/DELETE policies on these
--   tables (writes go exclusively through SECURITY DEFINER RPCs run as
--   service_role), so RLS-with-no-policy leaves anon/authenticated with no
--   access and service_role with full access — exactly the intent.
--
-- Idempotent (DROP … IF EXISTS). RLS is (re)asserted as ENABLED so the absence
-- of any SELECT policy is enforced rather than implicitly open.

ALTER TABLE public.scam_entities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scam_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_entity_links  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read scam_entities"       ON public.scam_entities;
DROP POLICY IF EXISTS "Public read scam_reports"        ON public.scam_reports;
DROP POLICY IF EXISTS "Public read report_entity_links" ON public.report_entity_links;

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (run manually if a legitimate anon consumer turns up):
--
--   CREATE POLICY "Public read scam_entities" ON public.scam_entities
--     FOR SELECT TO public USING (true);
--   CREATE POLICY "Public read scam_reports" ON public.scam_reports
--     FOR SELECT TO public USING (true);
--   CREATE POLICY "Public read report_entity_links" ON public.report_entity_links
--     FOR SELECT TO public USING (true);
-- ───────────────────────────────────────────────────────────────────────────
