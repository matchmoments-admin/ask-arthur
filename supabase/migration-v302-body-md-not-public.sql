-- Migration v302: stop anon and authenticated reading feed_items.body_md
--
-- WHY — this closes a gap that v299 opened and then asserted was closed.
--
-- v299 began storing the full username-scrubbed Reddit post body in
-- feed_items.body_md (up to 20,000 chars), where only a 500-character excerpt
-- had been kept before. Its header, and the privacy-impact amendment shipped
-- with it, both state:
--
--     "body_md is analysis-only and is not exposed by any public endpoint.
--      This preserves the position in reddit-intel-reddit-tos.md §3: no
--      republication of full post bodies."
--
-- Nothing enforced that. feed_items carries a row-level policy
-- (feed_items_public_read, v44:73 — `USING (published = TRUE)`), and RLS is
-- ROW level: it decides WHICH ROWS a role sees, never which columns. There is
-- no column grant on feed_items in any migration. Verified against production
-- with the public anon key before writing this:
--
--     GET /rest/v1/feed_items?source=eq.reddit&select=id,body_md
--     → 200 [{"id":1617,"body_md":null}, ...]
--
-- The nulls are only because the scraper has not yet run with v299 applied.
-- The read itself succeeds, so the first scrape would have published every
-- full post body through the REST API — the exact outcome two documents in
-- that PR promised was impossible. A claimed control that no code enforces is
-- this repo's most-repeated defect, and this is a case of it that would have
-- shipped user-visible harm rather than a wrong number.
--
-- WHAT THIS CHANGES
--
-- Column-level SELECT on body_md is revoked from anon and authenticated. Every
-- Ask Arthur read path uses createServiceClient (service_role bypasses column
-- privileges), so no surface of ours is affected — checked before applying:
-- apps/web/app/api/feed/route.ts:14, apps/web/lib/feed-loaders.ts:22,46,
-- app/intel/regulator-alerts/page.tsx, api/mobile/regulator-alerts/route.ts
-- and the admin pages all take the service client.
--
-- KNOWN CONSEQUENCE, deliberate: because Postgres expands SELECT * to every
-- column and fails if the role lacks any one of them, an anon-key `select=*`
-- against feed_items now errors instead of returning rows. Anon callers must
-- name the columns they want. We have no such caller; for a third party
-- holding the publishable anon key this is the intended tightening, not a
-- regression, and body_md was never part of the published contract.
--
-- Note this also covers the sources that already populate body_md (regulator
-- alerts and subscribed newsletters, 171 rows). Those are published material
-- and were lower-stakes, but there is no reason to leave the column readable
-- for them either.

BEGIN;

-- A column-level REVOKE alone does NOT work here, and the first version of
-- this migration made exactly that mistake: applying
-- `REVOKE SELECT (body_md) ... FROM anon` left the anon key still reading the
-- column, because Postgres treats table-level SELECT as covering every column.
-- A column privilege only bites once the table-wide grant is gone. So the
-- table grant is dropped and the permitted columns are enumerated.
--
-- Consequence worth knowing: this is now default-deny. A column added to
-- feed_items in a later migration is NOT readable by anon until it is added to
-- the grant below. That is the safer direction, but it will surprise someone,
-- so the failure mode is named here.

REVOKE SELECT ON public.feed_items FROM anon, authenticated;

GRANT SELECT (
  id, source, external_id, title, description, url, source_url,
  category, channel, r2_image_key, reddit_image_url, has_image,
  impersonated_brand, country_code, upvotes, verified, published,
  created_at, source_created_at, provenance_tier, tags, published_at,
  evidence_r2_key, embedding, embedding_model_version, competitor_extracted_at
) ON public.feed_items TO anon, authenticated;

COMMENT ON COLUMN public.feed_items.body_md IS
  'Fuller source text held for ANALYSIS ONLY. SELECT is revoked from anon and '
  'authenticated (v302) because RLS is row-level and cannot restrict a column. '
  'Public surfaces render `description`, the short excerpt. Do not add a '
  'column grant here without revisiting docs/compliance/reddit-intel-reddit-tos.md.';

COMMIT;

-- Verification (run after apply, with the PUBLISHABLE anon key):
--
--   GET /rest/v1/feed_items?source=eq.reddit&select=id,body_md
--     → 42501 permission denied for column body_md   (was: 200 + rows)
--
--   GET /rest/v1/feed_items?source=eq.reddit&select=id,title,description
--     → 200, unchanged — the public feed contract still works
--
--   SELECT grantee, privilege_type, column_name
--   FROM information_schema.column_privileges
--   WHERE table_name = 'feed_items' AND column_name = 'body_md';
--     → service_role / postgres only
