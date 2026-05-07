-- Migration v103: move pg_trgm + vector out of public into extensions schema
--
-- Closes 2 advisor WARNs (extension_in_public). The advisor recommends not
-- installing extensions in the public schema because:
--   1. Extension-owned functions/operators clutter the public namespace.
--   2. Extension upgrades can silently re-export functions that shadow
--      user-defined functions (the search_path_mutable risk).
--   3. Most managed-Postgres conventions (RDS, Supabase defaults) place
--      extensions in a dedicated schema. pgcrypto and pg_stat_statements
--      are already in `extensions` on this project; this migration brings
--      pg_trgm and vector in line.
--
-- Risk vector: 9 user-defined RPCs explicitly SET search_path = public,
-- pg_catalog. After ALTER EXTENSION ... SET SCHEMA extensions, the
-- operators (<=>, <->, similarity()) live in `extensions` and would
-- become unresolvable inside those 9 functions. We update each function's
-- search_path to add `extensions` BEFORE moving the extensions.
--
-- Default role search_path (postgres / authenticator) already includes
-- `extensions`, so PostgREST queries via supabase-js are unaffected. No
-- TS code references `public.<=>` / `public.similarity` explicitly
-- (verified via grep). Existing indexes (e.g. idx_acnc_*_hnsw,
-- idx_acnc_charity_legal_name_trgm) bind to opclasses by OID, not name,
-- so they survive the move.
--
-- Order:
--   1. Update 9 RPC search_paths to: public, extensions, pg_catalog.
--      This works whether the extensions are in public OR in extensions
--      — the operator lookup tries each schema in order.
--   2. ALTER EXTENSION pg_trgm SET SCHEMA extensions.
--   3. ALTER EXTENSION vector SET SCHEMA extensions.
--
-- Idempotent: ALTER FUNCTION SET is idempotent; ALTER EXTENSION
-- SET SCHEMA is a no-op if already there.

-- ─── 1. Update 9 RPC search_paths to include extensions ─────────────────────

ALTER FUNCTION public.match_charities_by_embedding(
  p_query_embedding vector, p_match_count integer, p_min_similarity real
) SET search_path = public, extensions, pg_catalog;

ALTER FUNCTION public.match_feed_items_narrative(
  p_query_embedding vector, p_match_count integer, p_min_similarity real, p_since_days integer
) SET search_path = public, extensions, pg_catalog;

ALTER FUNCTION public.match_reddit_intel(
  p_query_embedding vector, p_match_count integer, p_min_similarity real
) SET search_path = public, extensions, pg_catalog;

ALTER FUNCTION public.match_reddit_intel_themes(
  p_query_embedding vector, p_match_count integer, p_min_similarity real
) SET search_path = public, extensions, pg_catalog;

ALTER FUNCTION public.match_scam_reports(
  p_query_embedding vector, p_match_count integer, p_min_similarity real, p_since_days integer
) SET search_path = public, extensions, pg_catalog;

ALTER FUNCTION public.match_scam_reports_hybrid(
  p_query_text text, p_query_embedding vector, p_match_count integer, p_min_similarity real, p_since_days integer, p_rrf_k integer
) SET search_path = public, extensions, pg_catalog;

ALTER FUNCTION public.match_themes_by_centroid(
  p_query_embedding vector, p_match_count integer, p_min_similarity double precision, p_min_signal_strength text
) SET search_path = public, extensions, pg_catalog;

ALTER FUNCTION public.match_verified_scams(
  p_query_embedding vector, p_match_count integer, p_min_similarity real
) SET search_path = public, extensions, pg_catalog;

ALTER FUNCTION public.search_charities(
  p_query text, p_limit integer
) SET search_path = public, extensions, pg_catalog;

-- ─── 2. Move pg_trgm to extensions schema ───────────────────────────────────
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- ─── 3. Move vector to extensions schema ────────────────────────────────────
ALTER EXTENSION vector SET SCHEMA extensions;

-- ─── Verification (run manually after apply) ────────────────────────────────
-- SELECT extname, extnamespace::regnamespace
-- FROM pg_extension
-- WHERE extname IN ('pg_trgm','vector');
--   → both should show 'extensions'
--
-- SELECT proname, proconfig
-- FROM pg_proc
-- WHERE proname LIKE 'match_%' OR proname='search_charities';
--   → all should include 'search_path=public, extensions, pg_catalog'
--
-- SELECT count(*) FROM pg_advisors WHERE name='extension_in_public';
--   → 0
--
-- Smoke-test by calling search_charities + at least one match_* RPC and
-- confirming non-zero rows return (or, if data is sparse, that no
-- "operator does not exist" error is raised).
