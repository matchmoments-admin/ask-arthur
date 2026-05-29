-- migration-v163-commit-scam-cluster.sql
--
-- Atomic cluster commit for the cluster-builder cron (cron-hardening #523 H1c).
--
-- ROOT CAUSE: cluster-builder created each cluster with THREE separate,
-- non-transactional calls — INSERT scam_clusters, INSERT cluster_members,
-- UPDATE scam_reports.cluster_id. A crash between them left a cluster with
-- members but reports never stamped; the next nightly run then sees those
-- reports still unclustered and re-clusters them into a SECOND cluster.
--
-- FIX: do all three in one PL/pgSQL function (implicit transaction) so they
-- commit together or not at all. The UPDATE guards on `cluster_id IS NULL` so
-- a re-run can't re-stamp already-clustered reports. Member insert is
-- ON CONFLICT DO NOTHING against the (cluster_id, report_id) UNIQUE.
--
-- The caller (cluster-builder.ts) bounds p_report_ids to <= MAX_CLUSTER_SIZE
-- (5000) and skips noise mega-clusters (a popular link-shortener entity could
-- otherwise union thousands of unrelated reports into one giant component and
-- this UPDATE would lock a huge slice of the hot scam_reports table). The
-- guard lives in the app so the array reaching this function is always small.
--
-- SECURITY DEFINER + service_role-only (REVOKE FROM PUBLIC per v160/#512).
-- search_path = '' with fully-qualified refs per supabase/CLAUDE.md §4; only
-- pg_catalog builtins (array_length, unnest, ANY) are used.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT are safe to re-run.

CREATE OR REPLACE FUNCTION public.commit_scam_cluster(
  p_report_ids        BIGINT[],
  p_primary_scam_type TEXT,
  p_primary_brand     TEXT,
  p_entity_count      INT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cluster_id BIGINT;
BEGIN
  IF p_report_ids IS NULL OR array_length(p_report_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.scam_clusters (
    cluster_type, primary_scam_type, primary_brand,
    member_count, entity_count, status
  )
  VALUES (
    'entity_overlap', p_primary_scam_type, p_primary_brand,
    array_length(p_report_ids, 1), COALESCE(p_entity_count, 0), 'active'
  )
  RETURNING id INTO v_cluster_id;

  INSERT INTO public.cluster_members (cluster_id, report_id)
  SELECT v_cluster_id, unnest(p_report_ids)
  ON CONFLICT (cluster_id, report_id) DO NOTHING;

  UPDATE public.scam_reports
     SET cluster_id = v_cluster_id
   WHERE id = ANY(p_report_ids)
     AND cluster_id IS NULL;

  RETURN v_cluster_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.commit_scam_cluster(BIGINT[], TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_scam_cluster(BIGINT[], TEXT, TEXT, INT)
  TO service_role;
