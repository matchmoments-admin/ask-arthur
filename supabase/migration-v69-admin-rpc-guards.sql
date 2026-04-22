-- migration-v69-admin-rpc-guards.sql
--
-- Lock admin-only RPCs to the service role at the grant level. These RPCs
-- are SECURITY DEFINER, so without explicit REVOKE the default "execute to
-- PUBLIC" grant lets any authenticated caller invoke them — not what the
-- table RLS policies imply and not what the fraud dashboard code assumes.
--
-- Note: fraud_manager_search is LANGUAGE sql, so we can't inline a
-- `RAISE EXCEPTION` guard. Grant-level control is the correct lever.

REVOKE ALL ON FUNCTION fraud_manager_search(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fraud_manager_search(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION fraud_manager_search(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION fraud_manager_search(TEXT, TEXT) TO service_role;

-- Same treatment for the entity-enrichment trigger function. Its trigger
-- firing is unaffected (triggers run with the owner's privileges), but an
-- authenticated user SELECT-ing the function directly shouldn't be possible.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'trigger_entity_enrichment_pending' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION trigger_entity_enrichment_pending() FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION trigger_entity_enrichment_pending() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION trigger_entity_enrichment_pending() FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION trigger_entity_enrichment_pending() TO service_role';
  END IF;
END $$;
