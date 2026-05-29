-- migration-v161-merge-entity-enrichment-data.sql
--
-- Atomic jsonb merge for scam_entities.enrichment_data (cron-hardening #520 H2b).
--
-- ROOT CAUSE: urlscan-enrichment.ts merged URLScan results with a read-modify-
-- write — SELECT enrichment_data → { ...existing, urlscan } → UPDATE. Two
-- enrichers touching the same entity row between the read and the write
-- clobber each other (last-writer-wins). entity-enrichment + urlscan-enrichment
-- both write enrichment_data; the 30-min cron offset narrows but does not close
-- the window.
--
-- FIX: a single `UPDATE ... SET col = col || jsonb_build_object(key, value)` is
-- atomic at the row level in Postgres, so concurrent merges of DIFFERENT keys
-- are both preserved. SECURITY DEFINER + service_role-only (the only caller is
-- the service-role Inngest client); REVOKE FROM PUBLIC per the v160/#512 lesson.
--
-- search_path = '' with fully-qualified refs per supabase/CLAUDE.md §4 (the
-- SECURITY DEFINER threat model is unqualified-name hijack). Only core
-- pg_catalog builtins are used (|| , jsonb_build_object, coalesce — pg_catalog
-- is implicitly searched even under ''), no extension operators, so '' is safe.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT are safe to re-run.

CREATE OR REPLACE FUNCTION public.merge_entity_enrichment_data(
  p_entity_id BIGINT,
  p_key TEXT,
  p_value JSONB
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.scam_entities
     SET enrichment_data = COALESCE(enrichment_data, '{}'::jsonb)
                           || jsonb_build_object(p_key, p_value)
   WHERE id = p_entity_id;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_entity_enrichment_data(BIGINT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_entity_enrichment_data(BIGINT, TEXT, JSONB)
  TO service_role;
