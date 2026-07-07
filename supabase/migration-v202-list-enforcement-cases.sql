-- v202 — enforcement case worklist RPC for the admin tab
--        (Wave 1 PR 1.6 of docs/plans/clone-watch-enforcement-and-monetisation.md)
--
-- WHY: the /admin/clone-watch enforcement tab needs a read of the open cases
-- (shopfront_takedown_attempts, v201) joined to the lookalike they act on. This
-- is the visibility that (a) makes the enforcement work an audit-ready,
-- sellable artifact and (b) is the plan's prerequisite before ANY outbound send
-- is enabled — a human eyeballs cases first (the itch.io invariant).
--
-- Read-only, service_role only (the admin page queries server-side via the
-- service client behind requireAdmin()). Idempotent.

CREATE OR REPLACE FUNCTION public.list_enforcement_cases(
  p_limit int DEFAULT 200,
  p_include_closed boolean DEFAULT false
)
RETURNS TABLE (
  case_id bigint,
  clone_alert_id bigint,
  candidate_domain text,
  candidate_url text,
  target_brand_normalized text,
  lifecycle_state text,
  channel text,
  channel_autonomy text,
  case_status text,
  acts_on_parked boolean,
  external_ref text,
  evidence_bundle jsonb,
  next_action_at timestamptz,
  submitted_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    t.id,
    t.clone_alert_id,
    a.candidate_domain,
    a.candidate_url,
    a.target_brand_normalized,
    a.lifecycle_state,
    t.attempt_type,
    t.channel_autonomy,
    t.case_status,
    t.acts_on_parked,
    t.external_ref,
    t.evidence_bundle,
    t.next_action_at,
    t.submitted_at,
    t.updated_at,
    t.created_at
  FROM public.shopfront_takedown_attempts t
  JOIN public.shopfront_clone_alerts a ON a.id = t.clone_alert_id
  WHERE (p_include_closed OR t.case_status NOT IN ('closed', 'rejected', 'skipped'))
  ORDER BY
    -- humans first: cases needing action, oldest next-action first
    (t.case_status = 'queued') DESC,
    (t.channel_autonomy = 'human_required') DESC,
    t.next_action_at ASC NULLS LAST,
    t.updated_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE EXECUTE ON FUNCTION public.list_enforcement_cases(int, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_enforcement_cases(int, boolean)
  TO service_role;

-- Small aggregate for the tab header (open counts by status).
CREATE OR REPLACE FUNCTION public.enforcement_case_counts()
RETURNS TABLE (case_status text, n bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT t.case_status, count(*)
  FROM public.shopfront_takedown_attempts t
  WHERE t.case_status NOT IN ('closed', 'rejected', 'skipped')
  GROUP BY t.case_status;
$$;

REVOKE EXECUTE ON FUNCTION public.enforcement_case_counts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforcement_case_counts()
  TO service_role;
