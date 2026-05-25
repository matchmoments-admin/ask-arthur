-- v147: Clone-watch ultrareview follow-up — atomic JSONB merge, lowercase
-- enforcement, semantic fix on the public-impact aggregate.
--
-- Addresses BLOCKER B1 (cross-fn race on submitted_to JSONB) by replacing
-- read-modify-write app-side merges with a single SECURITY DEFINER RPC
-- that does the merge server-side under PG row-level locking. The three
-- Inngest functions (submit-netcraft, poll-netcraft, notify-brand) will
-- switch to calling this RPC instead of select+update.
--
-- Also addresses:
--   H3 lowercase enforcement on clone_alert_brand_replies.from_email
--   M1 brands_protected semantic — only count brands that were actually
--      submitted to a community blocklist OR notified to a brand team
--
-- See docs/plans/clone-watch-outreach.md §15 ultrareview follow-up.

-- 1. Atomic JSONB merge RPC. Sets ONE key on submitted_to without
--    clobbering siblings. Optional triage_status update in the same
--    transaction (used by submit-netcraft to flip to 'tp_actioned' after
--    successful submission).
CREATE OR REPLACE FUNCTION public.merge_clone_alert_submission(
  p_alert_id bigint,
  p_key text,
  p_value jsonb,
  p_set_triage_status text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  submitted_to jsonb,
  triage_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR length(p_key) > 64 THEN
    RAISE EXCEPTION 'invalid merge key: %', p_key USING ERRCODE = '22023';
  END IF;
  IF p_set_triage_status IS NOT NULL
     AND p_set_triage_status NOT IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned') THEN
    RAISE EXCEPTION 'invalid triage status: %', p_set_triage_status USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.shopfront_clone_alerts AS sca
  SET submitted_to = jsonb_set(
        COALESCE(sca.submitted_to, '{}'::jsonb),
        ARRAY[p_key],
        p_value,
        true
      ),
      triage_status = COALESCE(p_set_triage_status, sca.triage_status)
  WHERE sca.id = p_alert_id
  RETURNING sca.id, sca.submitted_to, sca.triage_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.merge_clone_alert_submission(bigint, text, jsonb, text) IS
  'Atomic JSONB merge for shopfront_clone_alerts.submitted_to. Use instead of app-side read-modify-write to avoid lost-update races between the three Inngest consumers (submit-netcraft, poll-netcraft, notify-brand).';

-- 2. Lowercase CHECK on clone_alert_brand_replies.from_email — defends
--    against direct INSERT bypassing the ingest_clone_alert_brand_reply
--    RPC's lower() normalisation. Without this, the suppression lookup
--    (clone_alert_recipient_is_suppressed) can miss STOP signals.
ALTER TABLE public.clone_alert_brand_replies
  ADD CONSTRAINT chk_clone_replies_from_email_lower
    CHECK (from_email = lower(from_email)) NOT VALID;

-- NOT VALID + then validate so existing data isn't blocked. (Currently
-- the table is empty; validating immediately is safe.)
ALTER TABLE public.clone_alert_brand_replies
  VALIDATE CONSTRAINT chk_clone_replies_from_email_lower;

-- 3. M1 brands_protected semantic — replace the public impact RPC so the
--    "brands protected" count only includes brands where action was
--    actually taken (Netcraft submit or brand notification), not just
--    "triaged TP and forgotten".
CREATE OR REPLACE FUNCTION public.clone_watch_public_impact(p_days int DEFAULT 30)
RETURNS TABLE (
  window_days int,
  candidates_total bigint,
  tp_confirmed_total bigint,
  netcraft_submits_total bigint,
  brand_notifications_total bigint,
  brands_protected bigint,
  computed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  WITH window_rows AS (
    SELECT *
    FROM public.shopfront_clone_alerts
    WHERE source = 'nrd'
      AND first_seen_at >= now() - (GREATEST(1, LEAST(p_days, 90)) * interval '1 day')
  )
  SELECT
    GREATEST(1, LEAST(p_days, 90)) AS window_days,
    COUNT(*) AS candidates_total,
    COUNT(*) FILTER (WHERE triage_status IN ('tp_confirmed','tp_actioned')) AS tp_confirmed_total,
    COUNT(*) FILTER (WHERE submitted_to ? 'netcraft') AS netcraft_submits_total,
    COUNT(*) FILTER (WHERE submitted_to ? 'brand_notification') AS brand_notifications_total,
    -- Brands where we actively took action (submitted to Netcraft OR notified
    -- the brand). A row that was triaged TP but never acted on doesn't count.
    COUNT(DISTINCT inferred_target_domain) FILTER (
      WHERE submitted_to ? 'netcraft' OR submitted_to ? 'brand_notification'
    ) AS brands_protected,
    now() AS computed_at
  FROM window_rows;
$$;

GRANT EXECUTE ON FUNCTION public.clone_watch_public_impact(int) TO anon, authenticated;

COMMENT ON FUNCTION public.clone_watch_public_impact(int) IS
  'Public aggregate impact for /clone-watch consumer page. brands_protected counts only brands where we submitted to a community blocklist OR notified the brand directly (active action, not just triage).';
