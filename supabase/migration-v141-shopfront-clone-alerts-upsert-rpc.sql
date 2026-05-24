-- v141 — Batch upsert RPC for clone-watch ingest paths.
--
-- shopfront_clone_alerts has a partial-style expression UNIQUE INDEX
-- (`uniq_clone_alerts_target_url` on COALESCE(target_shop_id::text,
-- inferred_target_domain), url_hash) that postgrest's `.upsert()` cannot
-- target through the JS client (the onConflict option is column-list
-- only, not expression). This RPC lets the Inngest writer pass a JSONB
-- batch and the function does the right INSERT ... ON CONFLICT DO
-- UPDATE SET last_seen_at = NOW() per row.
--
-- Layer 0 (S0E.2 NRD ingest) is the first caller. Phase A (#376) and
-- Phase B (#383) reuse the same RPC — same write target, same dedupe
-- semantics.

-- Signature changes require DROP FUNCTION first (Postgres restriction);
-- the REVOKE/GRANT statements below must be re-applied after any DROP.
CREATE OR REPLACE FUNCTION public.upsert_clone_alerts_batch(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  -- Per CLAUDE.md "long-running write loop" rule: cap at a real value so
  -- a 5K-row chunk under load can't silently truncate mid-batch.
  SET LOCAL statement_timeout = '300s';

  WITH upsert AS (
    INSERT INTO public.shopfront_clone_alerts (
      target_shop_id,
      inferred_target_domain,
      candidate_domain,
      candidate_url,
      url_hash,
      signals,
      severity,
      severity_tier,
      source
    )
    SELECT
      NULLIF(r->>'target_shop_id', '')::BIGINT,
      r->>'inferred_target_domain',
      r->>'candidate_domain',
      r->>'candidate_url',
      r->>'url_hash',
      COALESCE(r->'signals', '[]'::jsonb),
      (r->>'severity')::SMALLINT,
      -- Defensive: callers MUST supply a valid tier, but coerce unexpected
      -- values to 'low' so a single bad row can't violate the CHECK and
      -- abort the whole chunk's transaction.
      CASE
        WHEN r->>'severity_tier' IN ('low', 'medium', 'high', 'critical')
          THEN r->>'severity_tier'
        ELSE 'low'
      END,
      r->>'source'
    FROM jsonb_array_elements(p_rows) AS r
    ON CONFLICT (
      COALESCE(target_shop_id::text, inferred_target_domain),
      url_hash
    )
    DO UPDATE SET
      last_seen_at = NOW(),
      updated_at = NOW(),
      signals = EXCLUDED.signals,
      severity = GREATEST(public.shopfront_clone_alerts.severity, EXCLUDED.severity),
      severity_tier = CASE
        WHEN EXCLUDED.severity > public.shopfront_clone_alerts.severity
        THEN EXCLUDED.severity_tier
        ELSE public.shopfront_clone_alerts.severity_tier
      END
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT COUNT(*) FILTER (WHERE was_inserted) INTO inserted_count FROM upsert;

  RETURN inserted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_clone_alerts_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_clone_alerts_batch(JSONB) TO service_role;

COMMENT ON FUNCTION public.upsert_clone_alerts_batch(JSONB) IS
  'Batch INSERT ... ON CONFLICT DO UPDATE for shopfront_clone_alerts. Used by the Layer 0 NRD ingest (S0E.2) and reused by Phase A/B writers. Returns the count of newly-inserted rows (xmax = 0 trick). signals JSONB is overwritten on conflict; severity is monotone-max so a stronger signal on a re-observation does not regress.';