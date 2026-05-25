-- v143: Shopfront clone-watch — outreach foundation
--
-- Layer 1 (admin triage), 2 (community submission), 3+4 (brand notification),
-- 5 (weekly digest) all share this schema. See docs/plans/clone-watch-outreach.md.
--
-- Additive + idempotent. Re-running is safe. No data backfill needed —
-- existing rows get triage_status='pending' by default.

-- 1. Triage columns on shopfront_clone_alerts
ALTER TABLE public.shopfront_clone_alerts
  ADD COLUMN IF NOT EXISTS triage_status text
    CHECK (triage_status IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned'))
    DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS triage_by uuid,
  ADD COLUMN IF NOT EXISTS triage_at timestamptz,
  ADD COLUMN IF NOT EXISTS triage_notes text,
  ADD COLUMN IF NOT EXISTS submitted_to jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Partial index for the triage backlog query (admin dashboard hot path).
-- Small predicate, narrow result set — no Disk IO budget concern.
CREATE INDEX IF NOT EXISTS idx_clone_alerts_triage_pending
  ON public.shopfront_clone_alerts (first_seen_at DESC)
  WHERE triage_status = 'pending';

-- 2. brand_contact_directory: per-brand outreach channel mapping.
--    One row per AU brand in the static watchlist. Service-role only.
CREATE TABLE IF NOT EXISTS public.brand_contact_directory (
  brand text PRIMARY KEY,
  legitimate_domain text NOT NULL,
  channel_type text NOT NULL CHECK (channel_type IN (
    'bugcrowd_vdp',     -- formal: open Bugcrowd VDP page (Kmart Group covers Kmart + Target)
    'security_txt',     -- formal: RFC 9116 security.txt Contact: address (AusPost, CBA)
    'fraud_inbox',      -- courtesy: published fraud / abuse / phishing inbox
    'contact_form',     -- courtesy: web form URL (lowest priority — manual fill)
    'manual_review',    -- placeholder: admin must look up before send
    'none'              -- no known channel; do not send
  )),
  recipient text,                       -- email or URL depending on channel_type
  evidence_format text NOT NULL DEFAULT 'plain_email'
    CHECK (evidence_format IN ('plain_email','pgp_encrypted_email','bugcrowd_form','web_form')),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brand_contact_directory IS
  'Per-brand outreach channel mapping for clone-watch Layer 3/4. Hand-curated; one row per AU brand. Service-role only.';

ALTER TABLE public.brand_contact_directory ENABLE ROW LEVEL SECURITY;
-- No policies = service_role only. Anon/authed have no read or write.

-- 3. Seed Layer 3 formal-channel rows (the 4 brands we verified today).
--    Layer 4 courtesy-email rows are inserted by a follow-up data script
--    (kept out of the migration so they're easier to update without DDL churn).
INSERT INTO public.brand_contact_directory
  (brand, legitimate_domain, channel_type, recipient, evidence_format, notes)
VALUES
  ('Kmart', 'kmart.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/kmartaustralia-vdp-pro',
    'bugcrowd_form',
    'Kmart Group VDP covers Kmart + Target Australia (single program). Public form, no API.'),
  ('Target', 'target.com.au', 'bugcrowd_vdp',
    'https://bugcrowd.com/kmartaustralia-vdp-pro',
    'bugcrowd_form',
    'Same program as Kmart (Kmart Group umbrella).'),
  ('Australia Post', 'auspost.com.au', 'security_txt',
    'security@auspost.com.au',
    'plain_email',
    'RFC 9116 security.txt at /.well-known/security.txt (PGP available; plain email accepted).'),
  ('CBA', 'commbank.com.au', 'security_txt',
    'vulnerability@cba.com.au',
    'plain_email',
    'RFC 9116 security.txt (PGP available; plain email accepted). Expires 2024 in file but contact lives.')
ON CONFLICT (brand) DO UPDATE SET
  legitimate_domain = EXCLUDED.legitimate_domain,
  channel_type = EXCLUDED.channel_type,
  recipient = EXCLUDED.recipient,
  evidence_format = EXCLUDED.evidence_format,
  notes = EXCLUDED.notes,
  updated_at = now();

-- 4. Helper RPC for the admin triage dashboard: list pending rows with
--    optional limit. SECURITY DEFINER so the page query is consistent
--    regardless of which admin user calls it.
CREATE OR REPLACE FUNCTION public.list_clone_alerts_pending_triage(p_limit int DEFAULT 100)
RETURNS TABLE (
  id bigint,
  inferred_target_domain text,
  candidate_domain text,
  candidate_url text,
  signals jsonb,
  severity_tier text,
  triage_status text,
  first_seen_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT
    sca.id,
    sca.inferred_target_domain,
    sca.candidate_domain,
    sca.candidate_url,
    sca.signals,
    sca.severity_tier,
    sca.triage_status,
    sca.first_seen_at
  FROM public.shopfront_clone_alerts sca
  WHERE sca.triage_status = 'pending'
    AND sca.source = 'nrd'
  ORDER BY sca.first_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

-- Revoke from anon/authed so only service_role calls (admin dashboard).
REVOKE EXECUTE ON FUNCTION public.list_clone_alerts_pending_triage(int) FROM anon, authenticated;

-- 5. Helper RPC for transitioning triage status (used by /api/admin/clone-watch/triage).
CREATE OR REPLACE FUNCTION public.set_clone_alert_triage(
  p_alert_id bigint,
  p_status text,
  p_admin_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  triage_status text,
  triage_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_status NOT IN ('pending','tp_confirmed','fp','needs_investigation','tp_actioned') THEN
    RAISE EXCEPTION 'invalid triage status: %', p_status USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.shopfront_clone_alerts
  SET triage_status = p_status,
      triage_by = p_admin_id,
      triage_at = now(),
      triage_notes = COALESCE(p_notes, triage_notes)
  WHERE shopfront_clone_alerts.id = p_alert_id
  RETURNING shopfront_clone_alerts.id, shopfront_clone_alerts.triage_status, shopfront_clone_alerts.triage_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_clone_alert_triage(bigint, text, uuid, text) FROM anon, authenticated;

-- 6. Helper RPC for weekly digest aggregation (Layer 5).
CREATE OR REPLACE FUNCTION public.clone_watch_weekly_metrics(p_days int DEFAULT 7)
RETURNS TABLE (
  candidates_total bigint,
  triaged_tp bigint,
  triaged_fp bigint,
  triaged_investigate bigint,
  pending bigint,
  brands_touched bigint,
  submissions_netcraft bigint,
  notifications_sent bigint
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
    COUNT(*) AS candidates_total,
    COUNT(*) FILTER (WHERE triage_status IN ('tp_confirmed','tp_actioned')) AS triaged_tp,
    COUNT(*) FILTER (WHERE triage_status = 'fp') AS triaged_fp,
    COUNT(*) FILTER (WHERE triage_status = 'needs_investigation') AS triaged_investigate,
    COUNT(*) FILTER (WHERE triage_status = 'pending') AS pending,
    COUNT(DISTINCT inferred_target_domain) AS brands_touched,
    COUNT(*) FILTER (WHERE submitted_to ? 'netcraft') AS submissions_netcraft,
    COUNT(*) FILTER (WHERE submitted_to ? 'brand_notification') AS notifications_sent
  FROM window_rows;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_watch_weekly_metrics(int) FROM anon, authenticated;
